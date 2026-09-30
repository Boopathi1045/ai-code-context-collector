# AI Task Context


## Task

analyse the codebase completely

---

## Context Summary

Generated locally by AI Code Context Collector.

Files analyzed: 12
Candidate files: 11
Selected files: 2
Selected code blocks: 2

AI assistance:
Ollama / qwen2.5-coder:1.5b

---

## Project Structure

```text
├── backend/
│   └── controllers/
│       └── customer.controller.js
└── frontend/
    └── src/
        └── app/
            └── customers/
                └── customer-list.component.ts
```

---

## Relevant Files


### 1. backend/controllers/customer.controller.js

#### Why this file is relevant

This file contains the main controller for handling customer-related operations.

#### Relationships

```text
backend/controllers/customer.controller.js
    ↓ [IMPORTS] Imports customerService from customer.service.js
backend/services/customer.service.js

backend/controllers/customer.controller.js
    ↓ [IMPORTS] Imports subscriptionService from subscription.service.js
backend/services/subscription.service.js

backend/controllers/customer.controller.js
    ↓ [SERVICE] Controller uses backend service customer.service.js
backend/services/customer.service.js

backend/controllers/customer.controller.js
    ↓ [SERVICE] Controller uses backend service subscription.service.js
backend/services/subscription.service.js

backend/routes/customer.routes.js
    ↓ [IMPORTS] Imports customerController from customer.controller.js
backend/controllers/customer.controller.js
```

#### Relevant Symbols

* `getCustomers` (function) - This function retrieves all customers from the database.

#### Source Code

```javascript
const customerService = require('../services/customer.service');
const subscriptionService = require('../services/subscription.service');

async function getCustomers(req, res) {
  try {
    const customers = await customerService.findAllCustomers();
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getExpiringSubscriptions(req, res) {
  try {
    const days = req.query.days || 30;
    const expiring = await subscriptionService.findExpiringSubscriptions(days);
    res.json(expiring);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createCustomer(req, res) {
  try {
    const newCustomer = await customerService.create(req.body);
    res.status(201).json(newCustomer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = {
  getCustomers,
  getExpiringSubscriptions,
  createCustomer,
};

```


---


### 2. frontend/src/app/customers/customer-list.component.ts

#### Why this file is relevant

This file is responsible for displaying a list of customers and their subscriptions.

#### Relationships

```text
frontend/src/app/customers/customer-list.component.ts
    ↓ [IMPORTS] Imports CustomerService from customer.service.ts
frontend/src/app/customers/customer.service.ts

frontend/src/app/customers/customer-list.component.ts
    ↓ [ANGULAR_TEMPLATE] Component template HTML: customer-list.component.html
frontend/src/app/customers/customer-list.component.html

frontend/src/app/customers/customer-list.component.html
    ↓ [ANGULAR_TEMPLATE] Template companion component: customer-list.component.ts
frontend/src/app/customers/customer-list.component.ts

frontend/src/app/customers/customer-list.component.ts
    ↓ [ANGULAR_STYLE] Component stylesheet: customer-list.component.scss
frontend/src/app/customers/customer-list.component.scss

frontend/src/app/customers/customer-list.component.ts
    ↓ [SERVICE] Injects service CustomerService
backend/controllers/customer.controller.js
```

#### Relevant Symbols

* `loadCustomers` (method) - This method fetches and displays customer data in the component.

#### Source Code

```typescript
import { Component, OnInit } from '@angular/core';
import { CustomerService } from './customer.service';

@Component({
  selector: 'app-customer-list',
  templateUrl: './customer-list.component.html',
  styleUrls: ['./customer-list.component.scss']
})
export class CustomerListComponent implements OnInit {
  customers: any[] = [];
  expiringSubscriptions: any[] = [];

  constructor(private customerService: CustomerService) {}

  ngOnInit(): void {
    this.loadCustomers();
  }

  loadCustomers(): void {
    this.customerService.getCustomers().subscribe((data) => {
      this.customers = data;
    });
  }

  checkExpiringSubscriptions(): void {
    this.customerService.getExpiringSubscriptions().subscribe((data) => {
      this.expiringSubscriptions = data;
    });
  }
}

```


---


## Dependency Graph

```text
frontend/src/app/customers/customer-list.component.ts  ──[ SERVICE: Injects service CustomerService ]──>  backend/controllers/customer.controller.js
```

---

## Important Symbols

| File | Symbol | Type | Reason |
| ---- | ------ | ---- | ------ |
| `backend/controllers/customer.controller.js` | `getCustomers` | function | This function retrieves all customers from the database. |
| `frontend/src/app/customers/customer-list.component.ts` | `loadCustomers` | method | This method fetches and displays customer data in the component. |

---

## AI Instructions

Use the supplied source code as the source of truth.

Before suggesting implementation:
1. Understand the existing architecture.
2. Identify the exact files that need changes.
3. Explain why each file needs modification.
4. Give implementation instructions step-by-step.
5. Do not invent APIs, functions, models, or variables.
6. Do not assume omitted files are irrelevant.
7. If more source code is required, explicitly request the exact file.
8. Preserve the existing architecture unless a change is necessary.