#!/bin/bash

# Phase 6 Comprehensive Test Runner
# Validates all requirements for repository secrets and migration

set -e

echo "🚀 Starting Phase 6 Comprehensive Test Suite"
echo "=============================================="
echo "Testing repository secrets migration and functionality"
echo ""

# Configuration
API_URL=${API_URL:-"http://localhost:6000"}
TEST_TIMEOUT=${TEST_TIMEOUT:-300}  # 5 minutes
LOG_DIR="./test-logs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create log directory
mkdir -p "$LOG_DIR"

# Function to run a test with logging
run_test() {
    local test_name="$1"
    local test_command="$2"
    local log_file="$LOG_DIR/${test_name}.log"
    
    echo -e "${BLUE}📋 Running: $test_name${NC}"
    echo "Command: $test_command"
    echo "Log: $log_file"
    echo ""
    
    if timeout "$TEST_TIMEOUT" $test_command > "$log_file" 2>&1; then
        echo -e "${GREEN}✅ $test_name - PASSED${NC}"
        echo ""
        return 0
    else
        local exit_code=$?
        echo -e "${RED}❌ $test_name - FAILED (exit code: $exit_code)${NC}"
        echo "Last 20 lines from log:"
        tail -20 "$log_file" | sed 's/^/  /'
        echo ""
        return $exit_code
    fi
}

# Function to check if API server is running
check_api_server() {
    echo -e "${BLUE}🔍 Checking API server availability...${NC}"
    
    if curl -f "$API_URL/api/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ API server is running${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠️  API server not available at $API_URL${NC}"
        echo "Some tests may be skipped"
        return 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${BLUE}🔍 Checking prerequisites...${NC}"
    
    local missing_deps=()
    
    # Check for Node.js
    if ! command -v node &> /dev/null; then
        missing_deps+=("node")
    fi
    
    # Check for required Node modules
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}⚠️  node_modules not found, running npm install...${NC}"
        npm install
    fi
    
    # Check for database files
    if [ ! -f "apps/api/src/database/schema.ts" ]; then
        missing_deps+=("database schema")
    fi
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        echo -e "${RED}❌ Missing prerequisites: ${missing_deps[*]}${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ All prerequisites satisfied${NC}"
    return 0
}

# Function to backup database
backup_database() {
    if [ -f "apex.db" ]; then
        echo -e "${BLUE}💾 Backing up existing database...${NC}"
        cp apex.db "apex.db.phase6-backup-$(date +%Y%m%d-%H%M%S)"
        echo -e "${GREEN}✅ Database backed up${NC}"
    fi
}

# Function to run migration tests
run_migration_tests() {
    echo -e "${YELLOW}📊 Phase 1: Database Migration Tests${NC}"
    echo "===================================="
    
    run_test "migration_syntax_validation" "node -c apps/api/src/database/migrations/migration-runner.ts"
    run_test "migration_test_execution" "node apps/api/src/database/migrations/migration-runner.test.ts"
    
    echo ""
}

# Function to run service layer tests
run_service_tests() {
    echo -e "${YELLOW}🔧 Phase 2: Service Layer Tests${NC}"
    echo "==============================="
    
    # Test the core service functionality
    run_test "secrets_service_tests" "node phase-6-comprehensive-test.js"
    
    echo ""
}

# Function to run API endpoint tests
run_api_tests() {
    echo -e "${YELLOW}🌐 Phase 3: API Endpoint Tests${NC}"
    echo "=============================="
    
    if check_api_server; then
        run_test "repository_api_endpoints" "node test-repository-api-endpoints.js"
        run_test "existing_api_compatibility" "npm run test:e2e -- --testPathPattern=secrets.spec"
    else
        echo -e "${YELLOW}⚠️  Skipping API tests - server not available${NC}"
    fi
    
    echo ""
}

# Function to run proxy integration tests
run_proxy_tests() {
    echo -e "${YELLOW}🔐 Phase 4: Proxy Integration Tests${NC}"
    echo "=================================="
    
    if check_api_server; then
        # Check if proxy is available
        if curl -f --proxy "http://localhost:9350" "http://httpbin.org/ip" > /dev/null 2>&1; then
            run_test "proxy_integration" "node test-proxy-integration.js"
            run_test "existing_proxy_tests" "npm run test:e2e -- --testPathPattern=secrets-proxy.spec"
        else
            echo -e "${YELLOW}⚠️  Skipping proxy tests - proxy not available${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  Skipping proxy tests - API server not available${NC}"
    fi
    
    echo ""
}

# Function to run validation scenarios
run_validation_tests() {
    echo -e "${YELLOW}✅ Phase 5: Validation Scenarios${NC}"
    echo "================================"
    
    # Test edge cases and real-world scenarios
    run_test "edge_case_validation" "node -e 'require(\"./phase-6-comprehensive-test.js\").runEdgeCases()'"
    
    echo ""
}

# Function to generate final report
generate_report() {
    echo -e "${BLUE}📊 Generating Test Report${NC}"
    echo "========================="
    
    local total_tests=0
    local passed_tests=0
    local failed_tests=0
    
    echo "Test Results Summary:" > "$LOG_DIR/test-report.txt"
    echo "====================" >> "$LOG_DIR/test-report.txt"
    echo "Generated: $(date)" >> "$LOG_DIR/test-report.txt"
    echo "" >> "$LOG_DIR/test-report.txt"
    
    for log_file in "$LOG_DIR"/*.log; do
        if [ -f "$log_file" ]; then
            local test_name=$(basename "$log_file" .log)
            total_tests=$((total_tests + 1))
            
            if grep -q "✅" "$log_file" || grep -q "PASSED" "$log_file"; then
                passed_tests=$((passed_tests + 1))
                echo "✅ $test_name - PASSED" >> "$LOG_DIR/test-report.txt"
            else
                failed_tests=$((failed_tests + 1))
                echo "❌ $test_name - FAILED" >> "$LOG_DIR/test-report.txt"
            fi
        fi
    done
    
    echo "" >> "$LOG_DIR/test-report.txt"
    echo "Summary:" >> "$LOG_DIR/test-report.txt"
    echo "Total Tests: $total_tests" >> "$LOG_DIR/test-report.txt"
    echo "Passed: $passed_tests" >> "$LOG_DIR/test-report.txt"
    echo "Failed: $failed_tests" >> "$LOG_DIR/test-report.txt"
    
    if [ $total_tests -gt 0 ]; then
        local success_rate=$(( passed_tests * 100 / total_tests ))
        echo "Success Rate: $success_rate%" >> "$LOG_DIR/test-report.txt"
    fi
    
    echo ""
    echo -e "${GREEN}📄 Test report generated: $LOG_DIR/test-report.txt${NC}"
    cat "$LOG_DIR/test-report.txt"
    
    if [ $failed_tests -eq 0 ]; then
        echo -e "\n${GREEN}🎉 All tests passed! Phase 6 validation successful.${NC}"
        return 0
    else
        echo -e "\n${RED}💥 $failed_tests test(s) failed. Please review before production deployment.${NC}"
        return 1
    fi
}

# Function to clean up
cleanup() {
    echo -e "${BLUE}🧹 Cleaning up...${NC}"
    
    # Remove test databases
    rm -f test-phase6.sqlite*
    
    # Clean up any test files that might have been created
    find . -name "test-*.tmp" -delete 2>/dev/null || true
    
    echo -e "${GREEN}✅ Cleanup complete${NC}"
}

# Main execution
main() {
    echo "Starting Phase 6 test execution at $(date)"
    echo "API URL: $API_URL"
    echo "Test timeout: $TEST_TIMEOUT seconds"
    echo "Log directory: $LOG_DIR"
    echo ""
    
    # Check prerequisites
    if ! check_prerequisites; then
        echo -e "${RED}❌ Prerequisites check failed${NC}"
        exit 1
    fi
    
    # Backup database
    backup_database
    
    # Run test phases
    local overall_success=true
    
    run_migration_tests || overall_success=false
    run_service_tests || overall_success=false
    run_api_tests || overall_success=false
    run_proxy_tests || overall_success=false
    run_validation_tests || overall_success=false
    
    # Generate final report
    if generate_report; then
        if $overall_success; then
            echo -e "\n${GREEN}🏆 Phase 6 validation completed successfully!${NC}"
            echo -e "${GREEN}✅ Repository secrets feature is ready for production.${NC}"
        else
            echo -e "\n${YELLOW}⚠️  Phase 6 validation completed with some issues.${NC}"
            echo -e "${YELLOW}🔍 Please review failed tests before deploying.${NC}"
        fi
    else
        echo -e "\n${RED}❌ Phase 6 validation failed.${NC}"
        echo -e "${RED}🚫 Do not deploy to production until issues are resolved.${NC}"
        overall_success=false
    fi
    
    # Cleanup
    cleanup
    
    # Exit with appropriate code
    if $overall_success; then
        exit 0
    else
        exit 1
    fi
}

# Handle script interruption
trap 'echo -e "\n${YELLOW}🛑 Test execution interrupted${NC}"; cleanup; exit 1' INT TERM

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --api-url)
            API_URL="$2"
            shift 2
            ;;
        --timeout)
            TEST_TIMEOUT="$2"
            shift 2
            ;;
        --help)
            echo "Phase 6 Test Runner"
            echo "==================="
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --api-url URL     API server URL (default: http://localhost:6000)"
            echo "  --timeout SECONDS Test timeout in seconds (default: 300)"
            echo "  --help            Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  API_URL          Same as --api-url"
            echo "  TEST_TIMEOUT     Same as --timeout"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Run main function
main "$@"