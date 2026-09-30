import { expect } from 'chai';
import { SecretScanner } from '../src/security/secretScanner';

describe('SecretScanner', () => {
  it('should detect and redact API keys', () => {
    const raw = 'const API_KEY = "sk_live_1234567890abcdef";\nconst config = { active: true };';
    const result = SecretScanner.scanAndRedact(raw);

    expect(result.hasSecrets).to.be.true;
    expect(result.sanitizedContent).to.include('const API_KEY = "[REDACTED_SECRET]";');
    expect(result.sanitizedContent).to.not.include('sk_live_1234567890abcdef');
  });

  it('should detect and redact Database connection passwords', () => {
    const raw = 'const uri = "mongodb+srv://admin_user:super_secret_password_123@cluster0.mongodb.net/app";';
    const result = SecretScanner.scanAndRedact(raw);

    expect(result.hasSecrets).to.be.true;
    expect(result.sanitizedContent).to.include('mongodb+srv://admin_user:[REDACTED_PASSWORD]@cluster0.mongodb.net/app');
    expect(result.sanitizedContent).to.not.include('super_secret_password_123');
  });

  it('should detect and redact Private Keys', () => {
    const raw = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1W...
...dummy...
-----END RSA PRIVATE KEY-----`;
    const result = SecretScanner.scanAndRedact(raw);

    expect(result.hasSecrets).to.be.true;
    expect(result.sanitizedContent).to.include('[REDACTED_PRIVATE_KEY]');
  });

  it('should detect and redact AI Provider and Google API keys', () => {
    const raw = 'const key = "sk-proj-abc123xyz456secretkeyvalue789"; const google = "AIzaSyD1234567890abcdefghijklmnopqrst";';
    const result = SecretScanner.scanAndRedact(raw);

    expect(result.hasSecrets).to.be.true;
    expect(result.sanitizedContent).to.not.include('abc123xyz456secretkeyvalue789');
    expect(result.sanitizedContent).to.not.include('AIzaSyD1234567890abcdefghijklmnopqrst');
  });

  it('should detect and redact sensitive query parameters in URLs', () => {
    const raw = 'const webhook = "https://api.example.com/notify?apiKey=secret_admin_token_999&user=123";';
    const result = SecretScanner.scanAndRedact(raw);

    expect(result.hasSecrets).to.be.true;
    expect(result.sanitizedContent).to.not.include('secret_admin_token_999');
  });

  it('should leave normal code untouched', () => {
    const raw = `export class CustomerService {
  private apiUrl = '/api/customers';
  constructor(private http: HttpClient) {}
  getCustomers() { return this.http.get(this.apiUrl); }
}`;
    const result = SecretScanner.scanAndRedact(raw);

    expect(result.hasSecrets).to.be.false;
    expect(result.sanitizedContent).to.equal(raw);
  });
});
