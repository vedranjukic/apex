# Phase 6: Comprehensive Testing Guide

## Overview

This document describes the comprehensive test suite for validating the repository secrets feature implementation. Phase 6 ensures that all requirements are met and the feature is ready for production deployment.

## Test Components

### 1. Core Test Script: `phase-6-comprehensive-test.js`

**Purpose**: Validates database migration and secret resolution logic

**Coverage**:
- ✅ Database migration execution and verification
- ✅ Secret resolution priority hierarchy (repository > project > global)
- ✅ Environment variables vs secrets separation
- ✅ Migration idempotency
- ✅ Edge cases (invalid URLs, orphaned secrets, etc.)

**Key Tests**:
- `MIGRATION_EXECUTION`: Migration runs without errors
- `MIGRATION_REPOSITORY_SECRETS`: Project secrets properly migrated to repository scope
- `MIGRATION_UNMIGRATED_PRESERVED`: Non-GitHub/invalid projects remain unchanged
- `RESOLUTION_REPOSITORY_PRIORITY`: Repository secrets override global ones
- `RESOLUTION_CONTEXT_REPOSITORY_WINS`: Repository beats project in mixed context
- `VALIDATION_MIGRATION_IDEMPOTENT`: Multiple runs don't cause issues

### 2. API Endpoint Tests: `test-repository-api-endpoints.js`

**Purpose**: Validates new repository-scoped secrets API endpoints

**Coverage**:
- ✅ Repository listing (`GET /api/secrets/repositories`)
- ✅ Repository secrets CRUD operations
- ✅ Secret type handling (secrets vs environment variables)
- ✅ Validation and error handling
- ✅ Edge cases (special characters, long values, duplicates)

**Key Tests**:
- Repository secrets creation, listing, updating, deletion
- Proper scope validation (repository vs project vs global)
- Error handling for invalid inputs and missing resources

### 3. Proxy Integration Tests: `test-proxy-integration.js`

**Purpose**: Validates MITM proxy integration with repository secrets

**Coverage**:
- ✅ Secret resolution for proxy configuration
- ✅ Domain-based secret matching
- ✅ Environment variable exclusion from proxy
- ✅ Secret priority in proxy context
- ✅ Dynamic secret updates

**Key Tests**:
- Proxy correctly resolves repository-scoped secrets
- Environment variables are excluded from MITM interception
- Secret updates propagate to proxy configuration
- Domain matching works correctly

### 4. Test Runner: `run-phase-6-tests.sh`

**Purpose**: Orchestrates all tests with proper logging and reporting

**Features**:
- ✅ Prerequisite checking
- ✅ Database backup
- ✅ Progressive test execution
- ✅ Comprehensive logging
- ✅ Final report generation

## Test Execution

### Prerequisites

1. **Node.js Environment**: Ensure Node.js and npm are installed
2. **Database Access**: SQLite database should be accessible
3. **API Server** (optional): For full integration tests
4. **Proxy Service** (optional): For proxy integration tests

### Running Tests

#### Quick Start
```bash
./run-phase-6-tests.sh
```

#### With Custom Configuration
```bash
./run-phase-6-tests.sh --api-url http://localhost:6000 --timeout 600
```

#### Individual Test Components
```bash
# Migration and service tests (no API server needed)
node phase-6-comprehensive-test.js

# API endpoint tests (requires API server)
node test-repository-api-endpoints.js

# Proxy integration tests (requires API and proxy)
node test-proxy-integration.js
```

### Environment Variables

- `API_URL`: API server URL (default: http://localhost:6000)
- `TEST_TIMEOUT`: Test timeout in seconds (default: 300)
- `PROXY_HOST`: Proxy host (default: localhost)
- `PROXY_PORT`: Proxy port (default: 9350)

## Test Scenarios

### Migration Validation

**Scenario 1: GitHub Project Migration**
- Project with GitHub URL → Repository-scoped secret
- Verify correct repository ID extraction
- Verify project scope cleared

**Scenario 2: Non-GitHub Project Preservation**
- GitLab URL → Remains project-scoped
- Invalid URL → Remains project-scoped
- No URL → Remains project-scoped

**Scenario 3: Environment Variable Handling**
- `isSecret: false` → Not affected by migration
- Preserved in original scope

### Secret Resolution Validation

**Scenario 1: Priority Hierarchy**
```
Repository "owner/repo" has:
- Global: API_KEY = "global-value"
- Repository: API_KEY = "repo-value"

Resolution for "owner/repo" → "repo-value"
```

**Scenario 2: Mixed Context Resolution**
```
Context: project="proj1", repository="owner/repo"
- Global: API_KEY = "global-value"
- Project: API_KEY = "project-value" 
- Repository: API_KEY = "repo-value"

Resolution → "repo-value" (repository wins)
```

**Scenario 3: Secrets vs Environment Variables**
```
Repository secrets for proxy:
- SECRET_KEY (isSecret=true) → Included
- NODE_ENV (isSecret=false) → Excluded
```

### API Endpoint Validation

**Repository CRUD Operations**:
- Create repository secret
- List repository secrets
- Update repository secret
- Delete repository secret
- Proper error handling (404, validation errors)

**Scope Validation**:
- Repository secrets have `repositoryId` set
- Repository secrets have `projectId` as null
- Proper unique constraints by repository and name

### Proxy Integration Validation

**MITM Proxy Configuration**:
- Only actual secrets (`isSecret=true`) included
- Repository-scoped secrets override global ones
- Domain-based secret matching works
- Secret updates propagate to proxy

## Expected Results

### Success Criteria

For Phase 6 validation to pass, ALL of the following must be true:

1. **Migration Success**:
   - All GitHub project secrets migrated to repository scope
   - Non-GitHub projects preserved as project-scoped
   - Environment variables unaffected
   - Migration is idempotent (can run multiple times safely)

2. **Resolution Accuracy**:
   - Repository secrets override global secrets by name
   - Repository secrets override project secrets in mixed context
   - Environment variables excluded from secret resolution for proxy

3. **API Functionality**:
   - All repository endpoints work correctly
   - Proper validation and error handling
   - CRUD operations maintain data integrity

4. **Proxy Integration**:
   - Secrets correctly resolved for proxy configuration
   - Environment variables excluded from MITM interception
   - Domain matching functions properly

### Acceptance Criteria Mapping

| Original Requirement | Test Coverage | Validation Method |
|---------------------|---------------|-------------------|
| Repository-scoped secrets | ✅ | API CRUD tests + Resolution tests |
| Project → Repository migration | ✅ | Migration execution + Verification |
| GitHub URL parsing | ✅ | Migration test with various URL formats |
| Priority hierarchy | ✅ | Resolution tests with multiple scopes |
| Environment variable separation | ✅ | Service tests + Proxy exclusion tests |
| MITM proxy integration | ✅ | Proxy integration tests |
| Backward compatibility | ✅ | Existing API tests still pass |

## Troubleshooting

### Common Issues

**Migration Tests Fail**:
- Check database schema is up to date
- Verify `parseGitHubUrl` function works correctly
- Check test data setup

**API Tests Fail**:
- Ensure API server is running
- Verify new endpoints are implemented
- Check database connection

**Proxy Tests Fail**:
- Verify MITM proxy is running
- Check proxy port configuration
- Ensure secrets service integration

### Debug Mode

Add debug logging to test scripts:
```bash
DEBUG=1 node phase-6-comprehensive-test.js
```

### Log Analysis

Check test logs in `./test-logs/` directory:
- `migration_syntax_validation.log`
- `secrets_service_tests.log`
- `repository_api_endpoints.log`
- `proxy_integration.log`

## Production Readiness

### Pre-Deployment Checklist

- [ ] All tests pass with 100% success rate
- [ ] Migration tested with production-like data volume
- [ ] API endpoints documented
- [ ] Proxy integration verified
- [ ] Performance impact assessed
- [ ] Rollback plan prepared
- [ ] Monitoring alerts configured

### Risk Assessment

**Low Risk**:
- New repository endpoints (additive functionality)
- Environment variable separation (improves security)

**Medium Risk**:
- Migration changes existing data structure
- Secret resolution hierarchy changes

**Mitigation**:
- Database backup before migration
- Gradual rollout with monitoring
- Feature flags for new functionality

## Next Steps

After successful Phase 6 validation:

1. **Documentation Update**: Update user documentation and API docs
2. **Performance Testing**: Load test with realistic data volumes  
3. **Security Review**: Final security audit of implementation
4. **Deployment Planning**: Plan staged rollout strategy
5. **Monitoring Setup**: Configure alerts and dashboards
6. **User Communication**: Prepare release notes and migration guide

---

**Note**: This testing guide ensures comprehensive validation of the repository secrets feature before production deployment. All tests must pass before the feature is considered ready for release.