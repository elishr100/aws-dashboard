import axios from 'axios';
import type {
  AWSAccount,
  SessionStatus,
  Resource,
  ResourceStats,
  ScanRequest,
  ScanJob,
  SecurityFinding,
  SecurityAlert,
  ComplianceReport,
  AuditRequest,
  FindingSeverity,
  FindingStatus,
  AccountInfo,
  AccountGroup,
  OrganizationStructure,
  AccountHealthScore,
  OrganizationInsight,
} from '../types';
import type { CostDashboardSummary } from '../types/cost';

// Analytics types
export interface AlertStats {
  total: number;
  unacknowledged: number;
  bySeverity: Record<string, number>;
}

export interface OrganizationHierarchy {
  id: string;
  name: string;
  type: string;
  children?: OrganizationHierarchy[];
}

export interface AnalyticsData {
  overview: {
    totalAccounts: number;
    totalResources: number;
    totalCost: number;
  };
  costs: {
    trend: string;
    total: number;
    topSpenders: Array<{ accountId: string; cost: number; percentage: number }>;
  };
  security: {
    overallScore: number;
    status: string;
  };
  compliance: {
    overallScore: number;
    status: string;
  };
}

export interface AnalyticsComparison {
  accounts: string[];
  metrics: Record<string, unknown>;
}

export interface AnalyticsBenchmark {
  accountId: string;
  benchmarks: Record<string, unknown>;
}

export interface AnalyticsTrends {
  costs: {
    daily: Array<{ date: string; value: number }>;
  };
  security: {
    weekly: Array<{ date: string; value: number }>;
  };
}

export interface ChargebackReport {
  startDate: string;
  endDate: string;
  allocationType: string;
  breakdown: Record<string, unknown>;
}

export interface AnalyticsSearchRequest {
  query: string;
  filters?: Record<string, unknown>;
}

export interface AnalyticsSearchResult {
  results: unknown[];
  count: number;
}

export interface CostAllocation {
  breakdown: Array<{ name: string; cost: number }>;
}

const api = axios.create({
  baseURL: '/api',
  timeout: 300000, // 5 minutes - needed for security audit with many resources
});

// Error handling interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.error || error.message || 'An error occurred';
    console.error('API Error:', message);
    return Promise.reject(new Error(message));
  }
);

export const accountsApi = {
  getAll: async (): Promise<AWSAccount[]> => {
    const { data } = await api.get('/accounts');
    return data.accounts;
  },
};

export const sessionApi = {
  getStatus: async (): Promise<SessionStatus> => {
    const { data } = await api.get('/session/status');
    // Map backend response to frontend type
    return {
      valid: data.session?.valid ?? false,
      expiresAt: data.session?.expiresAt,
      profile: data.session?.profile || 'unknown',
      error: data.error,
    };
  },
  refresh: async (profile?: string): Promise<void> => {
    await api.post('/session/refresh', { profile });
  },
};

export const scanApi = {
  start: async (request: ScanRequest): Promise<ScanJob> => {
    const { data } = await api.post('/scan', request);
    return data;
  },
  createEventSource: (jobId: string): EventSource => {
    return new EventSource(`/api/scan/${jobId}/stream`);
  },
};

export const resourcesApi = {
  getAll: async (params?: {
    profile?: string;
    region?: string;
    type?: string;
    vpcId?: string;
  }): Promise<{ resources: Resource[]; count: number; cached?: boolean; cacheExpiresIn?: number }> => {
    const { data } = await api.get('/resources', { params });
    return data;
  },
  getStats: async (params?: {
    profile?: string;
    region?: string;
  }): Promise<ResourceStats> => {
    const { data } = await api.get('/resources/stats', { params });
    return data.stats;
  },
};

export const securityApi = {
  startAudit: async (request: AuditRequest): Promise<{ jobId: string; streamUrl: string }> => {
    const { data } = await api.post('/security/audit', request);
    return data;
  },
  createAuditEventSource: (jobId: string): EventSource => {
    return new EventSource(`/api/security/audit/${jobId}/stream`);
  },
  downloadReport: (jobId: string, format: 'json' | 'csv' | 'pdf', profile?: string): void => {
    const profileParam = profile ? `&profile=${encodeURIComponent(profile)}` : '';
    const url = `/api/security/audit/${jobId}/report?format=${format}${profileParam}`;
    window.open(url, '_blank');
  },
  getFindings: async (params?: {
    profile?: string;
    region?: string;
    severity?: FindingSeverity;
    status?: FindingStatus;
  }): Promise<SecurityFinding[]> => {
    const { data } = await api.get('/security/findings', { params });
    return data;
  },
  updateFinding: async (findingId: string, status: FindingStatus): Promise<void> => {
    await api.patch(`/security/findings/${findingId}`, { status });
  },
  getComplianceReport: async (profile: string, region: string): Promise<ComplianceReport> => {
    const { data } = await api.get('/security/compliance', {
      params: { profile, region },
    });
    return data;
  },
  getAlerts: async (params?: {
    profile?: string;
    region?: string;
    severity?: FindingSeverity;
    acknowledged?: boolean;
  }): Promise<SecurityAlert[]> => {
    const { data } = await api.get('/security/alerts', { params });
    return data;
  },
  getAlert: async (alertId: string): Promise<SecurityAlert> => {
    const { data } = await api.get(`/security/alerts/${alertId}`);
    return data;
  },
  acknowledgeAlert: async (alertId: string, acknowledgedBy?: string): Promise<void> => {
    await api.post(`/security/alerts/${alertId}/acknowledge`, { acknowledgedBy });
  },
  acknowledgeMultiple: async (alertIds: string[], acknowledgedBy?: string): Promise<number> => {
    const { data } = await api.post('/security/alerts/acknowledge-multiple', {
      alertIds,
      acknowledgedBy,
    });
    return data.acknowledged;
  },
  getAlertStats: async (): Promise<AlertStats> => {
    const { data } = await api.get('/security/alerts/stats');
    return data;
  },
  deleteAlert: async (alertId: string): Promise<void> => {
    await api.delete(`/security/alerts/${alertId}`);
  },
  createAlertStream: (): EventSource => {
    return new EventSource('/api/security/alerts/stream');
  },
};

export const organizationApi = {
  getStructure: async (): Promise<OrganizationStructure> => {
    const { data } = await api.get('/organization');
    return data;
  },
  getAccounts: async (params?: {
    type?: string;
    environment?: string;
    status?: string;
  }): Promise<{ accounts: AccountInfo[]; count: number }> => {
    const { data } = await api.get('/organization/accounts', { params });
    return data;
  },
  getAccount: async (accountId: string): Promise<AccountInfo> => {
    const { data } = await api.get(`/organization/accounts/${accountId}`);
    return data;
  },
  getAccountHealth: async (accountId: string): Promise<AccountHealthScore> => {
    const { data } = await api.get(`/organization/accounts/${accountId}/health`);
    return data;
  },
  addAccount: async (account: Partial<AccountInfo>): Promise<AccountInfo> => {
    const { data } = await api.post('/organization/accounts', account);
    return data;
  },
  getGroups: async (params?: {
    type?: string;
  }): Promise<{ groups: AccountGroup[]; count: number }> => {
    const { data } = await api.get('/organization/groups', { params });
    return data;
  },
  getGroup: async (groupId: string): Promise<AccountGroup> => {
    const { data } = await api.get(`/organization/groups/${groupId}`);
    return data;
  },
  getGroupAccounts: async (groupId: string): Promise<{ accounts: AccountInfo[]; count: number }> => {
    const { data } = await api.get(`/organization/groups/${groupId}/accounts`);
    return data;
  },
  createGroup: async (group: Partial<AccountGroup>): Promise<AccountGroup> => {
    const { data } = await api.post('/organization/groups', group);
    return data;
  },
  updateGroup: async (groupId: string, updates: Partial<AccountGroup>): Promise<AccountGroup> => {
    const { data } = await api.patch(`/organization/groups/${groupId}`, updates);
    return data;
  },
  deleteGroup: async (groupId: string): Promise<void> => {
    await api.delete(`/organization/groups/${groupId}`);
  },
  getInsights: async (): Promise<{ insights: OrganizationInsight[]; count: number }> => {
    const { data } = await api.get('/organization/insights');
    return data;
  },
  getHierarchy: async (): Promise<OrganizationHierarchy> => {
    const { data } = await api.get('/organization/hierarchy');
    return data;
  },
};

export const analyticsApi = {
  getAggregated: async (accountIds?: string[]): Promise<AnalyticsData> => {
    const params = accountIds ? { accountIds: accountIds.join(',') } : {};
    const { data } = await api.get('/analytics/aggregated', { params });
    return data;
  },
  compareAccounts: async (accountIds: string[]): Promise<AnalyticsComparison> => {
    const { data } = await api.post('/analytics/comparison', { accountIds });
    return data;
  },
  getBenchmark: async (accountId: string): Promise<AnalyticsBenchmark> => {
    const { data } = await api.get(`/analytics/benchmarks/${accountId}`);
    return data;
  },
  getTrends: async (): Promise<AnalyticsTrends> => {
    const { data } = await api.get('/analytics/trends');
    return data;
  },
  generateChargeback: async (
    startDate: string,
    endDate: string,
    allocationType: 'BY_ACCOUNT' | 'BY_TAG' | 'BY_TEAM'
  ): Promise<ChargebackReport> => {
    const { data } = await api.post('/analytics/chargeback', {
      startDate,
      endDate,
      allocationType,
    });
    return data;
  },
  search: async (request: AnalyticsSearchRequest): Promise<AnalyticsSearchResult> => {
    const { data } = await api.post('/analytics/search', request);
    return data;
  },
  getSummary: async (): Promise<AnalyticsData> => {
    const { data } = await api.get('/analytics/summary');
    return data;
  },
  getCostAllocation: async (groupBy?: 'service' | 'region' | 'account'): Promise<CostAllocation> => {
    const params = groupBy ? { groupBy } : {};
    const { data } = await api.get('/analytics/cost-allocation', { params });
    return data;
  },
};

export const costApi = {
  getDashboardSummary: async (profile: string): Promise<CostDashboardSummary> => {
    const { data } = await api.get('/cost/dashboard', {
      params: { profile },
    });
    return data;
  },
  refreshCosts: async (profile: string): Promise<void> => {
    await api.post('/cost/refresh', { profile });
  },
};

export default api;
