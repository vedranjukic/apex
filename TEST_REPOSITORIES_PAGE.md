# How to Test the Repositories Page

## 🚀 **Setup**

1. **Start the development servers**:
   ```bash
   cd /home/daytona/feature-per-repository-secrets-and-envir-2
   yarn serve
   ```

2. **Access the dashboard**: `http://localhost:4200`

## 📋 **How to Add Repositories**

### **Method 1: Create Projects from GitHub URLs**

1. **Go to the home page** (`http://localhost:4200`)
2. **Click "+ New Project"**
3. **Enter a GitHub repository URL** (e.g., `https://github.com/facebook/react`)
4. **Create the project**
5. **Navigate to Repositories page** by:
   - Clicking the **GitBranch icon** (🔗) in the settings area, OR
   - Going directly to `http://localhost:4200/repositories`

### **Method 2: Direct Repository Access**

You can also directly manage secrets for any GitHub repository:
1. **Go to**: `http://localhost:4200/repositories/facebook%2Freact/secrets`
2. **Add secrets/environment variables** for the `facebook/react` repository

## 🎯 **What You Should See**

### **Empty State (No Projects)**
- Message: "No repositories found"
- Instruction: "Create projects from GitHub repositories to see them here"

### **With Projects/Repositories**
- **Repository list** showing discovered GitHub repositories
- **Project count** for each repository
- **Secret/environment variable counts**
- **"Add Secrets" button** for repositories without secrets
- **"Manage" button** for repositories with existing secrets

## 🔧 **Repository Discovery**

Repositories are **automatically discovered** from:
- ✅ **Project Git URLs** that point to GitHub repositories
- ✅ **Existing repository-scoped secrets** (even if no active projects)

The system will parse GitHub URLs and extract `owner/repo` format automatically.

## 📝 **Features to Test**

1. **Repository Management**:
   - List all repositories from projects
   - Show secret/env var counts
   - Project count per repository

2. **Add Secrets**:
   - Click "Add Secrets" for new repositories
   - Configure secrets and environment variables
   - Use "Is Secret" checkbox to distinguish between them

3. **Secret Inheritance**:
   - Create a new project from the same GitHub URL
   - Repository secrets should automatically be available

4. **Navigation**:
   - GitBranch icon in project list settings area
   - Direct URL access to repositories and repository-specific secrets

## ✅ **Expected Behavior**

- **No "Add Repository" button** needed - they're discovered automatically
- **Repositories appear** when you create projects from GitHub URLs  
- **Seamless integration** with the existing project creation workflow
- **Automatic inheritance** of repository settings in new projects