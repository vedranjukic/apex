#!/usr/bin/env node

/**
 * Quick validation script to check if repository API routes are implemented
 * This is a prerequisite check before running the full test suite
 */

const fs = require('fs');
const path = require('path');

class APIRouteValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.checks = [];
  }

  async validate() {
    console.log('🔍 Validating Repository Secrets API Implementation');
    console.log('==================================================');

    try {
      await this.checkSecretServiceImplementation();
      await this.checkAPIRoutesImplementation();
      await this.checkMigrationImplementation();
      await this.printResults();
      
      if (this.errors.length === 0) {
        console.log('\n✅ All validation checks passed! API implementation is ready for testing.');
        return true;
      } else {
        console.log('\n❌ Validation failed. Please address the errors before running tests.');
        return false;
      }
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      return false;
    }
  }

  async checkSecretServiceImplementation() {
    console.log('\n📋 Checking secrets service implementation...');

    const servicePath = './apps/api/src/modules/secrets/secrets.service.ts';
    
    if (!fs.existsSync(servicePath)) {
      this.addError('Secrets service file not found', servicePath);
      return;
    }

    const serviceContent = fs.readFileSync(servicePath, 'utf8');
    
    // Check for repository-specific methods
    const requiredMethods = [
      'listRepositories',
      'listRepositorySecrets', 
      'createRepositorySecret',
      'updateRepositorySecret',
      'removeRepositorySecret',
      'resolveForRepository',
      'resolveForContext',
      'resolveSecretsForContext'
    ];

    for (const method of requiredMethods) {
      if (serviceContent.includes(`async ${method}(`)) {
        this.addCheck(`✅ Method ${method} implemented`);
      } else {
        this.addError(`Method ${method} not found in secrets service`, servicePath);
      }
    }

    // Check for repository-related interfaces
    const requiredInterfaces = [
      'RepositoryInfo',
      'repositoryId: string | null'
    ];

    for (const interfaceCheck of requiredInterfaces) {
      if (serviceContent.includes(interfaceCheck)) {
        this.addCheck(`✅ Interface ${interfaceCheck} found`);
      } else {
        this.addError(`Interface ${interfaceCheck} not found`, servicePath);
      }
    }

    // Check for proper resolution logic
    if (serviceContent.includes('repository-scoped > project-scoped > global')) {
      this.addCheck('✅ Priority hierarchy documented in code');
    } else {
      this.addWarning('Priority hierarchy not clearly documented in comments');
    }
  }

  async checkAPIRoutesImplementation() {
    console.log('\n🌐 Checking API routes implementation...');

    const routesPath = './apps/api/src/modules/secrets/secrets.routes.ts';
    
    if (!fs.existsSync(routesPath)) {
      this.addError('Secrets routes file not found', routesPath);
      return;
    }

    const routesContent = fs.readFileSync(routesPath, 'utf8');

    // Check if we need to add repository routes or if they're in a separate file
    const repoRoutesPath = './apps/api/src/modules/secrets/repositories.routes.ts';
    let hasRepositoryRoutes = false;

    if (fs.existsSync(repoRoutesPath)) {
      console.log('Found separate repository routes file');
      const repoRoutesContent = fs.readFileSync(repoRoutesPath, 'utf8');
      hasRepositoryRoutes = this.checkRepositoryRoutes(repoRoutesContent, repoRoutesPath);
    } else {
      // Check if repository routes are in the main routes file
      hasRepositoryRoutes = this.checkRepositoryRoutes(routesContent, routesPath);
    }

    if (!hasRepositoryRoutes) {
      this.addError('Repository routes not implemented. Need to add:', 
        'GET /api/secrets/repositories\n' +
        'GET /api/secrets/repositories/:repositoryId\n' +
        'POST /api/secrets/repositories/:repositoryId\n' +
        'PUT /api/secrets/repositories/:repositoryId/:id\n' +
        'DELETE /api/secrets/repositories/:repositoryId/:id'
      );
    }

    // Check for proper service integration
    if (routesContent.includes('secretsService.listRepositories') || 
        fs.existsSync(repoRoutesPath)) {
      this.addCheck('✅ Repository routes integrated with service');
    } else {
      this.addError('Repository routes not properly integrated with secrets service');
    }
  }

  checkRepositoryRoutes(content, filePath) {
    const requiredRoutes = [
      { pattern: /\.get\(['"]\/repositories['"]/, description: 'GET /repositories' },
      { pattern: /\.get\(['"]\/repositories\/:repositoryId['"]/, description: 'GET /repositories/:repositoryId' },
      { pattern: /\.post\(['"]\/repositories\/:repositoryId['"]/, description: 'POST /repositories/:repositoryId' },
      { pattern: /\.put\(['"]\/repositories\/:repositoryId\/:id['"]/, description: 'PUT /repositories/:repositoryId/:id' },
      { pattern: /\.delete\(['"]\/repositories\/:repositoryId\/:id['"]/, description: 'DELETE /repositories/:repositoryId/:id' }
    ];

    let foundRoutes = 0;
    for (const route of requiredRoutes) {
      if (route.pattern.test(content)) {
        this.addCheck(`✅ ${route.description} route implemented`);
        foundRoutes++;
      } else {
        this.addError(`${route.description} route not found`, filePath);
      }
    }

    return foundRoutes === requiredRoutes.length;
  }

  async checkMigrationImplementation() {
    console.log('\n🔄 Checking migration implementation...');

    const migrationPath = './apps/api/src/database/migrations/migration-runner.ts';
    
    if (!fs.existsSync(migrationPath)) {
      this.addError('Migration runner not found', migrationPath);
      return;
    }

    const migrationContent = fs.readFileSync(migrationPath, 'utf8');

    // Check for project to repository migration
    if (migrationContent.includes('migrateProjectSecretsToRepositorySecrets')) {
      this.addCheck('✅ Project to repository migration implemented');
    } else {
      this.addError('Project to repository migration not found', migrationPath);
    }

    // Check for GitHub URL parsing
    if (migrationContent.includes('parseGitHubUrl')) {
      this.addCheck('✅ GitHub URL parsing integrated');
    } else {
      this.addError('GitHub URL parsing not found in migration', migrationPath);
    }

    // Check for proper error handling
    if (migrationContent.includes('try {') && migrationContent.includes('catch')) {
      this.addCheck('✅ Migration has error handling');
    } else {
      this.addWarning('Migration may lack proper error handling');
    }
  }

  addCheck(message) {
    this.checks.push(message);
    console.log(`  ${message}`);
  }

  addError(message, details = '') {
    this.errors.push({ message, details });
    console.log(`  ❌ ${message}`);
    if (details) {
      console.log(`     ${details}`);
    }
  }

  addWarning(message, details = '') {
    this.warnings.push({ message, details });
    console.log(`  ⚠️  ${message}`);
    if (details) {
      console.log(`     ${details}`);
    }
  }

  printResults() {
    console.log('\n📊 Validation Results');
    console.log('====================');
    console.log(`✅ Checks passed: ${this.checks.length}`);
    console.log(`⚠️  Warnings: ${this.warnings.length}`);
    console.log(`❌ Errors: ${this.errors.length}`);

    if (this.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      this.warnings.forEach((warning, index) => {
        console.log(`  ${index + 1}. ${warning.message}`);
        if (warning.details) {
          console.log(`     ${warning.details}`);
        }
      });
    }

    if (this.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.message}`);
        if (error.details) {
          console.log(`     ${error.details}`);
        }
      });
    }
  }
}

// Run validation if this file is executed directly
if (require.main === module) {
  const validator = new APIRouteValidator();
  validator.validate().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { APIRouteValidator };