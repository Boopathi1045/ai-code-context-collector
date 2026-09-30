import { expect } from 'chai';
import { FileFilter } from '../src/scanner/fileFilter';

describe('FileFilter', () => {
  const filter = new FileFilter(['temp_dir', '*.tmp'], 500);

  it('should ignore standard ignore directories', () => {
    expect(filter.shouldIgnoreDirectory('node_modules', 'node_modules')).to.be.true;
    expect(filter.shouldIgnoreDirectory('.git', '.git')).to.be.true;
    expect(filter.shouldIgnoreDirectory('dist', 'dist')).to.be.true;
    expect(filter.shouldIgnoreDirectory('build', 'build')).to.be.true;
    expect(filter.shouldIgnoreDirectory('.cache', '.cache')).to.be.true;
    expect(filter.shouldIgnoreDirectory('.angular', '.angular')).to.be.true;
    expect(filter.shouldIgnoreDirectory('.vscode', '.vscode')).to.be.true;
  });

  it('should ignore custom exclude patterns', () => {
    expect(filter.shouldIgnoreDirectory('temp_dir', 'src/temp_dir')).to.be.true;
    expect(filter.shouldIgnoreFile('test.tmp', 'src/test.tmp')).to.be.true;
  });

  it('should exclude sensitive and secret files', () => {
    expect(filter.shouldIgnoreFile('.env', '.env')).to.be.true;
    expect(filter.shouldIgnoreFile('.env.local', '.env.local')).to.be.true;
    expect(filter.shouldIgnoreFile('.env.production', 'config/.env.production')).to.be.true;
    expect(filter.shouldIgnoreFile('server.key', 'certs/server.key')).to.be.true;
    expect(filter.shouldIgnoreFile('cert.pem', 'certs/cert.pem')).to.be.true;
    expect(filter.shouldIgnoreFile('id_rsa', '.ssh/id_rsa')).to.be.true;
  });

  it('should exclude binary files', () => {
    expect(filter.shouldIgnoreFile('logo.png', 'assets/logo.png')).to.be.true;
    expect(filter.shouldIgnoreFile('photo.jpeg', 'assets/photo.jpeg')).to.be.true;
    expect(filter.shouldIgnoreFile('manual.pdf', 'docs/manual.pdf')).to.be.true;
    expect(filter.shouldIgnoreFile('app.zip', 'app.zip')).to.be.true;
    expect(filter.shouldIgnoreFile('tool.exe', 'bin/tool.exe')).to.be.true;
  });

  it('should exclude lock files', () => {
    expect(filter.shouldIgnoreFile('package-lock.json', 'package-lock.json')).to.be.true;
    expect(filter.shouldIgnoreFile('yarn.lock', 'yarn.lock')).to.be.true;
    expect(filter.shouldIgnoreFile('pnpm-lock.yaml', 'pnpm-lock.yaml')).to.be.true;
  });

  it('should allow valid source code files', () => {
    expect(filter.shouldIgnoreFile('customer.component.ts', 'src/app/customer.component.ts')).to.be.false;
    expect(filter.shouldIgnoreFile('customer.service.js', 'src/services/customer.service.js')).to.be.false;
    expect(filter.shouldIgnoreFile('template.html', 'src/app/template.html')).to.be.false;
    expect(filter.shouldIgnoreFile('styles.scss', 'src/styles.scss')).to.be.false;
    expect(filter.shouldIgnoreFile('data.json', 'src/data.json')).to.be.false;
  });

  it('should enforce file size limits', () => {
    const smallBytes = 100 * 1024; // 100KB
    const largeBytes = 600 * 1024; // 600KB (exceeds 500KB limit)

    expect(filter.shouldIgnoreFile('normal.ts', 'src/normal.ts', smallBytes)).to.be.false;
    expect(filter.shouldIgnoreFile('huge.ts', 'src/huge.ts', largeBytes)).to.be.true;
  });
});
