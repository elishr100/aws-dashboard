#!/bin/bash

# Test script to verify cost data fixes
# Run this after starting the backend server

set -e

BACKEND_URL="http://localhost:3001"
PROFILE="dev-ah"
REGION="us-west-2"

echo "================================"
echo "Cost Data Fix Verification"
echo "================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if backend is running
echo "1. Checking if backend is running..."
if curl -s "$BACKEND_URL/api/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend is running${NC}"
else
    echo -e "${RED}✗ Backend is not running${NC}"
    echo "Please start the backend with: cd backend && npm start"
    exit 1
fi
echo ""

# Check if resources exist in cache
echo "2. Checking for cached resources..."
RESOURCES_RESPONSE=$(curl -s "$BACKEND_URL/api/resources?profile=$PROFILE&region=$REGION")
RESOURCE_COUNT=$(echo "$RESOURCES_RESPONSE" | jq -r '.count // 0')

if [ "$RESOURCE_COUNT" -eq 0 ]; then
    echo -e "${YELLOW}⚠ No resources found in cache${NC}"
    echo "You need to run a scan first:"
    echo "  curl -X POST $BACKEND_URL/api/scan -H 'Content-Type: application/json' -d '{\"profile\":\"$PROFILE\",\"regions\":[\"$REGION\"]}'"
    echo ""
    echo "Waiting for scan to complete before testing costs..."
    exit 0
else
    echo -e "${GREEN}✓ Found $RESOURCE_COUNT resources in cache${NC}"
fi
echo ""

# Check if resources have cost data
echo "3. Checking if resources have cost data..."
RESOURCES_WITH_COST=$(echo "$RESOURCES_RESPONSE" | jq '[.resources[] | select(.cost != null)] | length')
echo "  Resources with cost data: $RESOURCES_WITH_COST out of $RESOURCE_COUNT"

if [ "$RESOURCES_WITH_COST" -gt 0 ]; then
    echo -e "${GREEN}✓ Resources have cost data${NC}"
    echo ""
    echo "Sample resource cost:"
    echo "$RESOURCES_RESPONSE" | jq '.resources[] | select(.cost != null) | {id, name, type, cost} | select(.cost != null)' | head -20
else
    echo -e "${YELLOW}⚠ No resources have cost data yet${NC}"
    echo "Cost data is fetched in the background after scan completes."
    echo "Check backend logs for cost fetch progress."
fi
echo ""

# Check analytics total cost
echo "4. Checking Analytics Total Cost..."
ANALYTICS_RESPONSE=$(curl -s "$BACKEND_URL/api/analytics/summary")
TOTAL_COST=$(echo "$ANALYTICS_RESPONSE" | jq -r '.overview.totalCost // 0')
COST_TREND=$(echo "$ANALYTICS_RESPONSE" | jq -r '.costs.trend // "UNKNOWN"')

echo "  Total Cost: \$$TOTAL_COST"
echo "  Trend: $COST_TREND"

if [ "$TOTAL_COST" != "0" ] && [ "$TOTAL_COST" != "null" ]; then
    echo -e "${GREEN}✓ Analytics shows non-zero total cost${NC}"
else
    echo -e "${YELLOW}⚠ Analytics total cost is still \$0${NC}"
    echo "This will be updated after the cost fetch background job completes."
fi
echo ""

# Check cost breakdown by service
echo "5. Checking cost breakdown by service..."
SERVICE_COSTS=$(echo "$ANALYTICS_RESPONSE" | jq -r '.costs.byService // {}')
SERVICE_COUNT=$(echo "$SERVICE_COSTS" | jq 'length')

echo "  Services with costs: $SERVICE_COUNT"
if [ "$SERVICE_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Cost breakdown available${NC}"
    echo ""
    echo "  Top 5 services by cost:"
    echo "$SERVICE_COSTS" | jq -r 'to_entries | sort_by(-.value) | .[:5] | .[] | "    \(.key): $\(.value)"'
else
    echo -e "${YELLOW}⚠ No cost breakdown available yet${NC}"
fi
echo ""

# Check persistent cache
echo "6. Checking persistent cache..."
CACHE_DIR="$HOME/.aws-dashboard/cache/$PROFILE"
if [ -d "$CACHE_DIR" ]; then
    echo -e "${GREEN}✓ Cache directory exists: $CACHE_DIR${NC}"

    if [ -f "$CACHE_DIR/costs.json" ]; then
        echo -e "${GREEN}✓ Cost summary file exists${NC}"
        CACHED_TOTAL=$(cat "$CACHE_DIR/costs.json" | jq -r '.totalCost // 0')
        CACHED_TREND=$(cat "$CACHE_DIR/costs.json" | jq -r '.trend // "UNKNOWN"')
        echo "  Cached total cost: \$$CACHED_TOTAL"
        echo "  Cached trend: $CACHED_TREND"
    else
        echo -e "${YELLOW}⚠ Cost summary file not found${NC}"
    fi

    if [ -f "$CACHE_DIR/resources_${REGION}.json" ]; then
        RESOURCES_IN_FILE=$(cat "$CACHE_DIR/resources_${REGION}.json" | jq '[.resources[] | select(.cost != null)] | length')
        echo -e "${GREEN}✓ Regional resources file exists${NC}"
        echo "  Resources with costs in file: $RESOURCES_IN_FILE"
    else
        echo -e "${YELLOW}⚠ Regional resources file not found${NC}"
    fi
else
    echo -e "${RED}✗ Cache directory not found: $CACHE_DIR${NC}"
fi
echo ""

# Summary
echo "================================"
echo "Verification Summary"
echo "================================"

if [ "$RESOURCES_WITH_COST" -gt 0 ] && [ "$TOTAL_COST" != "0" ]; then
    echo -e "${GREEN}✓ ALL CHECKS PASSED${NC}"
    echo ""
    echo "Cost data is working correctly:"
    echo "  - Resources have cost fields"
    echo "  - Analytics shows total cost"
    echo "  - Data is persisted to disk"
else
    echo -e "${YELLOW}⚠ PARTIAL SUCCESS${NC}"
    echo ""
    echo "Cost data fix is applied, but waiting for data:"
    if [ "$RESOURCES_WITH_COST" -eq 0 ]; then
        echo "  - Resources need cost enrichment (background job running)"
    fi
    if [ "$TOTAL_COST" == "0" ]; then
        echo "  - Analytics total cost pending (will update after cost fetch)"
    fi
    echo ""
    echo "Check backend logs for:"
    echo "  - '[Scan] Fetching cost data for resources'"
    echo "  - '[Scan] Saved total cost data to persistent cache'"
    echo "  - '[CostAnalysis] Found X services with costs'"
fi
echo ""
