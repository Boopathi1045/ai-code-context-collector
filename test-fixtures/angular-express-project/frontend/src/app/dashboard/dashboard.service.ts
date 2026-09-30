import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private apiUrl = '/api/dashboard';

  constructor(private http: HttpClient) {}

  getMetrics(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/metrics`);
  }

  getServerHealth(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/health`);
  }
}
