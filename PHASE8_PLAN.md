# Phase 8: Cross-Account Aggregation & Analytics

**Status**: 🚧 IN PROGRESS
**Started**: March 1, 2026

---

## 🎯 Objectives

Build comprehensive cross-account aggregation, comparison, and analytics capabilities on top of Phase 7's organization management foundation.

---

## 📋 Scope

### 1. AggregationService
- **Real-time data aggregation** across all 20 AWS accounts
- **Multi-dimensional metrics**: Resources, costs, security, compliance
- **Caching strategy**: Aggregate data with configurable TTL
- **Parallel queries**: Fetch data from multiple accounts concurrently
- **Error handling**: Graceful degradation if some accounts fail

### 2. Cross-Account Comparison
- **Account-to-account comparison**: Side-by-side metrics
- **Benchmarking**: Compare account against organization averages
- **Rankings**: Best/worst performing accounts
- **Percentile calculations**: Where each account stands
- **Trend analysis**: Historical comparison over time

### 3. Cost Allocation & Chargeback
- **Cost by account**: Detailed cost breakdown
- **Cost by tag**: Allocate costs to teams/projects
- **Chargeback reports**: Generate billing reports for teams
- **Cost trends**: Track spending patterns across accounts
- **Budget allocation**: Organization-wide budget distribution

### 4. Organization Analytics Dashboard
- **Executive summary**: High-level KPIs
- **Cost analytics**: Organization-wide cost insights
- **Security posture**: Aggregated security scores
- **Compliance dashboard**: Organization-wide compliance status
- **Resource utilization**: Capacity and efficiency metrics

### 5. Federated Search
- **Cross-account resource search**: Find resources across all accounts
- **Tag-based search**: Search by tags and metadata
- **Advanced filters**: Multiple criteria
- **Search history**: Track recent searches
- **Export results**: Download search results

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│               Organization Analytics Frontend                │
│  - Executive Dashboard                                       │
│  - Cross-Account Comparison                                  │
│  - Cost Allocation Reports                                   │
│  - Federated Search                                          │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                  Analytics API Layer                         │
│  - GET /api/analytics/aggregated                            │
│  - GET /api/analytics/comparison                            │
│  - GET /api/analytics/benchmarks/:accountId                 │
│  - GET /api/analytics/trends                                │
│  - POST /api/analytics/chargeback                           │
│  - POST /api/analytics/search                               │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                  AggregationService                          │
│  - aggregateResources()                                     │
│  - aggregateCosts()                                         │
│  - aggregateSecurity()                                      │
│  - aggregateCompliance()                                    │
│  - compareAccounts()                                        │
│  - benchmarkAccount()                                       │
│  - searchResources()                                        │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Resource    │  │ Cost        │  │ Security    │
│ Discovery   │  │ Analysis    │  │ Audit       │
│ Service     │  │ Service     │  │ Service     │
└─────────────┘  └─────────────┘  └─────────────┘
```

---

## 📊 Data Models

### AggregatedMetrics
```typescript
interface AggregatedMetrics {
  organizationId: string;
  period: string;
  generatedAt: string;

  resources: {
    total: number;
    byType: Record<string, number>;
    byRegion: Record<string, number>;
    byAccount: Record<string, number>;
  };

  costs: {
    total: number;
    byAccount: Record<string, number>;
    byService: Record<string, number>;
    byRegion: Record<string, number>;
    trend: 'INCREASING' | 'DECREASING' | 'STABLE';
  };

  security: {
    overallScore: number;
    criticalFindings: number;
    highFindings: number;
    byAccount: Record<string, AccountSecurityMetrics>;
  };

  compliance: {
    overallScore: number;
    byFramework: Record<string, number>;
    byAccount: Record<string, AccountComplianceMetrics>;
  };
}
```

### AccountComparison
```typescript
interface AccountComparison {
  accounts: AccountSummary[];
  metrics: {
    resources: AccountResourceMetrics[];
    costs: AccountCostMetrics[];
    security: AccountSecurityMetrics[];
    compliance: AccountComplianceMetrics[];
  };
  rankings: {
    lowestCost: string;
    highestSecurity: string;
    highestCompliance: string;
    mostResources: string;
  };
}
```

### ChargebackReport
```typescript
interface ChargebackReport {
  id: string;
  period: { startDate: string; endDate: string };
  allocationType: 'BY_ACCOUNT' | 'BY_TAG' | 'BY_TEAM';
  allocations: ChargebackAllocation[];
  totalCost: number;
  generatedAt: string;
}
```

---

## 🔧 Implementation Plan

### Step 1: AggregationService ✅
- Create `/backend/src/services/AggregationService.ts`
- Implement parallel account queries
- Aggregate resources, costs, security, compliance
- Cache aggregated data (5-minute TTL)

### Step 2: Comparison & Benchmarking ✅
- Add comparison methods to AggregationService
- Calculate percentiles and rankings
- Generate account benchmarks
- Compare multiple accounts side-by-side

### Step 3: Cost Allocation & Chargeback ✅
- Implement cost allocation logic
- Generate chargeback reports
- Support allocation by account, tag, or team
- Export to CSV/PDF

### Step 4: Analytics API ✅
- Create `/backend/src/routes/analytics.ts`
- Implement 8+ REST endpoints
- Add SSE streaming for long-running aggregations
- Error handling and validation

### Step 5: Federated Search ✅
- Implement cross-account resource search
- Support tag-based filtering
- Index resources for fast search
- Export search results

### Step 6: Analytics Frontend ✅
- Create Analytics dashboard page
- Cross-account comparison view
- Cost allocation reports page
- Federated search interface
- Charts and visualizations

### Step 7: Integration & Testing ✅
- Integrate with existing services
- Update server with analytics routes
- Build and test frontend
- Update documentation

---

## 📈 Success Metrics

- ✅ Aggregate data from all 20 accounts in < 10 seconds
- ✅ Cross-account comparison for 2-10 accounts
- ✅ Real-time cost allocation reports
- ✅ Federated search across all resources
- ✅ Executive dashboard with organization KPIs
- ✅ Performance: < 5 second page load
- ✅ Accuracy: 100% data consistency

---

## 🚀 Deliverables

1. **AggregationService** - Core aggregation engine
2. **Analytics API** - 8+ REST endpoints
3. **Analytics Frontend** - 3+ dashboard pages
4. **Comparison Engine** - Account benchmarking
5. **Chargeback Reports** - Cost allocation
6. **Federated Search** - Cross-account search
7. **Documentation** - PHASE8_SUCCESS.md

---

## 🔄 Integration with Previous Phases

- **Phase 7**: Uses OrganizationService for account management
- **Phase 5**: Uses CostAnalysisService for cost data
- **Phase 4**: Uses SecurityAuditService for security data
- **Phase 6**: Uses ComplianceService for compliance data
- **Phase 2**: Uses ResourceDiscoveryAgent for resource data

---

**Next**: Implement AggregationService
