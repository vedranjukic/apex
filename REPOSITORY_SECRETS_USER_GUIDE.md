# Repository Secrets & Environment Variables - User Guide

## Overview

Repository secrets and environment variables allow you to centrally manage configuration that is shared across all projects created from the same GitHub repository. This feature provides automatic inheritance during project creation, reducing setup time and ensuring consistency.

## Key Features

### 🔐 Repository Secrets
- API keys and sensitive credentials scoped to a repository
- Automatically injected via secure MITM proxy
- Support for various authentication types (Bearer, API key, etc.)
- Secure handling - values never enter sandbox containers

### 🔧 Environment Variables
- Non-sensitive configuration values
- Direct injection into sandbox environment
- Perfect for feature flags, debug settings, etc.

### 🔄 Automatic Inheritance
- Repository settings automatically inherited when creating projects from GitHub URLs
- Preview of inherited settings shown during project creation
- No manual configuration required

## How It Works

### 1. Setting Up Repository Configuration

1. **Navigate to Secrets Management**
   - Go to Settings → Secrets & Environment Variables
   - Or use the `/secrets` path in your dashboard

2. **Create Repository-Scoped Settings**
   - Select "Repository" as the scope
   - Enter the repository identifier (e.g., `owner/repo-name`)
   - Choose between Secret or Environment Variable
   - Configure the setting details

3. **Repository Identification**
   - Repository ID format: `owner/repository-name`
   - Example: `octocat/Hello-World`
   - Case sensitive, must match exact GitHub repository

### 2. Creating Projects with Inherited Settings

1. **Start New Project Creation**
   - Click "New Project" or use Ctrl+Shift+N
   - Fill in project details

2. **Enter GitHub URL**
   - Paste any GitHub URL (repository, issue, PR, branch)
   - Examples:
     - `https://github.com/owner/repo`
     - `https://github.com/owner/repo/issues/123`
     - `https://github.com/owner/repo/pull/456`
     - `https://github.com/owner/repo/tree/feature-branch`

3. **Review Inheritance Preview**
   - Repository settings preview appears automatically
   - Shows count and details of inherited settings
   - Expandable view with secrets and environment variables
   - Clear indication of repository source

4. **Create Project**
   - Repository settings are automatically inherited
   - No additional configuration required
   - Settings are immediately available in the sandbox

### 3. Managing Repository Settings

#### Adding Secrets
```
Name: STRIPE_SECRET_KEY
Value: sk_live_xxxxx
Domain: api.stripe.com
Auth Type: Bearer
Type: Secret
Repository: owner/my-repo
Description: Stripe API key for payments
```

#### Adding Environment Variables
```
Name: NODE_ENV
Value: production
Type: Environment Variable  
Repository: owner/my-repo
Description: Node.js environment
```

#### Viewing Repository Settings
- Use the Repository filter in secrets management
- Select specific repository to view all settings
- Export/import functionality for bulk management

## Best Practices

### 🔐 Security
- Use secrets for sensitive data (API keys, tokens, passwords)
- Use environment variables for non-sensitive configuration
- Regularly rotate API keys and update repository secrets
- Use descriptive names and descriptions for all settings

### 📁 Organization
- Group related settings by repository
- Use consistent naming conventions
- Document purpose in description fields
- Regular cleanup of unused settings

### 🔄 Workflow Integration
- Set up repository secrets before creating projects
- Use repository settings for shared configuration
- Override at project level only when necessary
- Test inheritance with sample projects

## Examples

### E-commerce Application
```
Repository: mycompany/ecommerce-app

Secrets:
- STRIPE_SECRET_KEY → api.stripe.com (Payment processing)
- PAYPAL_CLIENT_SECRET → api.paypal.com (Alternative payment)
- DB_PASSWORD → (Database credentials)

Environment Variables:
- NODE_ENV → production
- FEATURE_CHECKOUT_V2 → true
- LOG_LEVEL → info
```

### API Service
```
Repository: mycompany/api-service

Secrets:
- AWS_SECRET_ACCESS_KEY → amazonaws.com
- REDIS_AUTH_TOKEN → redis.example.com
- JWT_SECRET → (Token signing)

Environment Variables:
- AWS_REGION → us-east-1
- CACHE_TTL → 3600
- API_VERSION → v2
```

### Development Team Repository
```
Repository: team/shared-utilities

Secrets:
- GITHUB_TOKEN → api.github.com (Repository access)
- NPM_TOKEN → registry.npmjs.org (Package publishing)

Environment Variables:
- BUILD_ENV → ci
- TEST_TIMEOUT → 30000
- COVERAGE_THRESHOLD → 80
```

## Troubleshooting

### Repository Settings Not Appearing
- Verify repository ID format (`owner/repo-name`)
- Check repository scope in secrets management
- Ensure GitHub URL is correctly formatted
- Verify you have access to the repository

### Settings Not Applied to Sandbox
- Check secrets proxy configuration
- Verify domain mapping for secrets
- Test environment variable injection
- Review sandbox logs for errors

### Preview Not Showing
- Check browser console for API errors
- Verify API server is running
- Test repository secrets API endpoint directly
- Clear browser cache if necessary

## Advanced Usage

### Programmatic Access
Repository secrets are available via:
- MCP tool `list_secrets` (names only, never values)
- Environment variables in sandbox
- HTTPS proxy for API calls

### Integration with CI/CD
- Repository settings work with automated project creation
- API endpoints support bulk operations
- Export/import for configuration management

### Multi-Repository Workflows
- Different repositories can have different settings
- Inheritance based on specific repository ID
- Project-level overrides when needed

## Support

If you encounter issues with repository secrets inheritance:

1. Check implementation logs in browser console
2. Verify API server connectivity
3. Test with simple repository/settings combination
4. Review repository ID format and casing

For additional help, refer to the technical documentation or contact your system administrator.

---

**Note**: Repository secrets inheritance is automatically enabled and requires no additional configuration. The feature integrates seamlessly with existing project creation workflows.