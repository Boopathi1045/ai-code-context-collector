import { expect } from 'chai';
import { AstParser } from '../src/parser/astParser';

describe('AstParser', () => {
  const root = 'd:/Development/vscode_extension/test-fixtures/angular-express-project';

  it('should parse TypeScript classes, methods, and Angular decorators', () => {
    const code = `
import { Component, OnInit } from '@angular/core';
import { CustomerService } from './customer.service';

@Component({
  selector: 'app-customer-list',
  templateUrl: './customer-list.component.html',
  styleUrls: ['./customer-list.component.scss']
})
export class CustomerListComponent implements OnInit {
  customers: any[] = [];
  constructor(private customerService: CustomerService) {}
  ngOnInit(): void { this.loadCustomers(); }
  loadCustomers(): void {}
}
`;
    const parsed = AstParser.parseFile(
      `${root}/frontend/src/app/customers/customer-list.component.ts`,
      code,
      root,
      Date.now(),
      code.length
    );

    expect(parsed.language).to.equal('typescript');
    expect(parsed.symbols.map((s) => s.name)).to.include('CustomerListComponent');
    expect(parsed.symbols.map((s) => s.name)).to.include('loadCustomers');

    expect(parsed.angularMetadata).to.be.an('array').with.lengthOf(1);
    const compMeta = parsed.angularMetadata![0];
    expect(compMeta.type).to.equal('component');
    expect(compMeta.templateUrl).to.equal('./customer-list.component.html');
    expect(compMeta.styleUrls).to.deep.equal(['./customer-list.component.scss']);
    expect(compMeta.injectedServices).to.include('CustomerService');
  });

  it('should parse HTTP API calls in Angular services', () => {
    const code = `
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class CustomerService {
  private apiUrl = '/api/customers';
  constructor(private http: HttpClient) {}
  getCustomers() {
    return this.http.get(this.apiUrl);
  }
}
`;
    const parsed = AstParser.parseFile(
      `${root}/frontend/src/app/customers/customer.service.ts`,
      code,
      root,
      Date.now(),
      code.length
    );

    expect(parsed.apiCalls).to.be.an('array');
    expect(parsed.apiCalls!.some((c) => c.method === 'GET')).to.be.true;
  });

  it('should parse Express routes and controllers in JavaScript', () => {
    const code = `
const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer.controller');

router.get('/customers', customerController.getCustomers);
router.post('/customers', customerController.createCustomer);

module.exports = router;
`;
    const parsed = AstParser.parseFile(
      `${root}/backend/routes/customer.routes.js`,
      code,
      root,
      Date.now(),
      code.length
    );

    expect(parsed.expressRoutes).to.be.an('array').with.lengthOf(2);
    expect(parsed.expressRoutes![0].method).to.equal('GET');
    expect(parsed.expressRoutes![0].path).to.equal('/customers');
    expect(parsed.expressRoutes![0].handlerSymbol).to.equal('getCustomers');
  });

  it('should detect Mongoose models', () => {
    const code = `
const mongoose = require('mongoose');
const CustomerSchema = new mongoose.Schema({ name: String });
module.exports = mongoose.model('Customer', CustomerSchema);
`;
    const parsed = AstParser.parseFile(
      `${root}/backend/models/customer.model.js`,
      code,
      root,
      Date.now(),
      code.length
    );

    expect(parsed.isModel).to.be.true;
    expect(parsed.modelName).to.equal('Customer');
  });
});
