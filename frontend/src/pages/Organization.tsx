import { useQuery } from '@tanstack/react-query';
import { organizationApi } from '../lib/api';
import type { AccountInfo, OrganizationInsight } from '../types';

export default function Organization() {
  const { data: structure, isLoading: structureLoading } = useQuery({
    queryKey: ['organization-structure'],
    queryFn: () => organizationApi.getStructure(),
    refetchInterval: 30000,
  });

  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ['organization-accounts'],
    queryFn: () => organizationApi.getAccounts(),
    refetchInterval: 30000,
  });

  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ['organization-groups'],
    queryFn: () => organizationApi.getGroups(),
    refetchInterval: 30000,
  });

  const { data: insightsData } = useQuery({
    queryKey: ['organization-insights'],
    queryFn: () => organizationApi.getInsights(),
    refetchInterval: 60000,
  });

  if (structureLoading || accountsLoading || groupsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading organization data...</div>
      </div>
    );
  }

  const accounts = accountsData?.accounts || [];
  const groups = groupsData?.groups || [];
  const insights = insightsData?.insights || [];

  const accountsByType = accounts.reduce((acc, account) => {
    const type = account.type || 'UNKNOWN';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const getSeverityColor = (severity: OrganizationInsight['severity']) => {
    switch (severity) {
      case 'CRITICAL':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'WARNING':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'INFO':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusBadge = (status: AccountInfo['status']) => {
    const colors = {
      ACTIVE: 'bg-green-100 text-green-800',
      SUSPENDED: 'bg-yellow-100 text-yellow-800',
      INACTIVE: 'bg-gray-100 text-gray-800',
    };
    return colors[status] || colors.INACTIVE;
  };

  const getTypeBadge = (type: AccountInfo['type']) => {
    const colors = {
      PRODUCTION: 'bg-red-100 text-red-800',
      DEVELOPMENT: 'bg-blue-100 text-blue-800',
      INFRASTRUCTURE: 'bg-purple-100 text-purple-800',
      INTEGRATION: 'bg-indigo-100 text-indigo-800',
      NON_PRODUCTION: 'bg-gray-100 text-gray-800',
    };
    return colors[type] || colors.NON_PRODUCTION;
  };

  // Group accounts by environment for topology view
  const accountsByEnvironment = accounts.reduce((acc, account) => {
    // Detect environment from profile name or type
    let env = 'unknown';
    const profile = account.profile.toLowerCase();

    if (profile.includes('prod') || account.type === 'PRODUCTION') {
      env = 'production';
    } else if (profile.includes('dev') || account.type === 'DEVELOPMENT') {
      env = 'development';
    } else if (profile.includes('stage') || profile.includes('staging')) {
      env = 'staging';
    } else if (profile.includes('test') || profile.includes('qa')) {
      env = 'testing';
    } else if (account.type === 'INFRASTRUCTURE') {
      env = 'infrastructure';
    }

    if (!acc[env]) {
      acc[env] = [];
    }
    acc[env].push(account);
    return acc;
  }, {} as Record<string, AccountInfo[]>);

  const getEnvironmentColor = (env: string) => {
    const colors: Record<string, string> = {
      production: 'border-red-500 bg-red-900/20',
      development: 'border-green-500 bg-green-900/20',
      staging: 'border-yellow-500 bg-yellow-900/20',
      testing: 'border-blue-500 bg-blue-900/20',
      infrastructure: 'border-purple-500 bg-purple-900/20',
      unknown: 'border-gray-500 bg-gray-900/20',
    };
    return colors[env] || colors.unknown;
  };

  const getEnvironmentIcon = (env: string) => {
    const icons: Record<string, string> = {
      production: '🔴',
      development: '🟢',
      staging: '🟡',
      testing: '🔵',
      infrastructure: '🟣',
      unknown: '⚪',
    };
    return icons[env] || icons.unknown;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Organization Management</h1>
        <p className="text-gray-400">
          Manage AWS accounts, groups, and organization-wide insights
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Accounts</p>
              <p className="text-3xl font-bold text-white mt-1">
                {structure?.totalAccounts || 0}
              </p>
            </div>
            <div className="text-blue-500">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-400">
            Active: {structure?.activeAccounts || 0}
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Account Groups</p>
              <p className="text-3xl font-bold text-white mt-1">{groups.length}</p>
            </div>
            <div className="text-green-500">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-400">
            Organized by environment & region
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Production Accounts</p>
              <p className="text-3xl font-bold text-white mt-1">
                {accountsByType['PRODUCTION'] || 0}
              </p>
            </div>
            <div className="text-red-500">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-400">
            Development: {accountsByType['DEVELOPMENT'] || 0}
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Organization Insights</p>
              <p className="text-3xl font-bold text-white mt-1">{insights.length}</p>
            </div>
            <div className="text-yellow-500">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-400">Recommendations available</div>
        </div>
      </div>

      {/* Account Topology Visualization */}
      <div className="bg-gray-800 rounded-lg border border-gray-700">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">Account Topology</h2>
          <p className="text-sm text-gray-400 mt-1">
            Visual hierarchy of accounts grouped by environment
          </p>
        </div>
        <div className="p-6 space-y-6">
          {Object.entries(accountsByEnvironment).map(([env, envAccounts]) => (
            <div key={env} className={`border-l-4 ${getEnvironmentColor(env)} rounded-lg p-4`}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">{getEnvironmentIcon(env)}</span>
                <div>
                  <h3 className="text-white font-semibold text-lg capitalize">{env}</h3>
                  <p className="text-sm text-gray-400">{envAccounts.length} accounts</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pl-8">
                {envAccounts.map((account) => {
                  // Extract account ID from ARN if present
                  const accountIdMatch = account.profile.match(/\d{12}/);
                  const displayId = accountIdMatch ? accountIdMatch[0] : account.accountId;

                  return (
                    <div
                      key={account.accountId}
                      className="bg-gray-900 rounded-lg p-3 border border-gray-700 hover:border-gray-600 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">
                            {account.profile}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            {displayId && displayId.length === 12 && (
                              <div>ID: {displayId}</div>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              <span className="inline-flex items-center">
                                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                  <path
                                    fillRule="evenodd"
                                    d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                                {account.region || 'N/A'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${getStatusBadge(
                              account.status
                            )}`}
                          >
                            {account.status === 'ACTIVE' ? '✓' : '○'}
                          </span>
                        </div>
                      </div>

                      {/* Show source profile if available */}
                      {account.profile.includes('-') && (
                        <div className="mt-2 pt-2 border-t border-gray-800 text-xs text-gray-500">
                          Role-based access
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {Object.keys(accountsByEnvironment).length === 0 && (
            <div className="text-center py-8 text-gray-400">
              No accounts discovered. Please configure AWS profiles in ~/.aws/config
            </div>
          )}
        </div>
      </div>

      {/* Organization Insights */}
      {insights.length > 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="p-6 border-b border-gray-700">
            <h2 className="text-xl font-semibold text-white">Organization Insights</h2>
            <p className="text-sm text-gray-400 mt-1">
              Automated recommendations and best practices
            </p>
          </div>
          <div className="divide-y divide-gray-700">
            {insights.map((insight) => (
              <div key={insight.id} className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium border ${getSeverityColor(
                          insight.severity
                        )}`}
                      >
                        {insight.severity}
                      </span>
                      <span className="text-xs text-gray-400">{insight.type}</span>
                    </div>
                    <h3 className="text-white font-medium mt-2">{insight.title}</h3>
                    <p className="text-gray-400 text-sm mt-1">{insight.description}</p>
                    <p className="text-blue-400 text-sm mt-2">
                      💡 {insight.recommendation}
                    </p>
                    <div className="flex gap-4 mt-3 text-xs text-gray-500">
                      <span>Affected Accounts: {insight.affectedAccounts.length}</span>
                      <span>Detected: {new Date(insight.detectedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Accounts Table */}
      <div className="bg-gray-800 rounded-lg border border-gray-700">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">AWS Accounts</h2>
          <p className="text-sm text-gray-400 mt-1">All accounts in the organization</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Account
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Profile
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Region
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Environment
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {accounts.map((account) => (
                <tr key={account.accountId} className="hover:bg-gray-750">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-white">
                        {account.name || account.accountId}
                      </div>
                      <div className="text-xs text-gray-400">{account.accountId}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                    {account.profile}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                    {account.region}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getTypeBadge(
                        account.type
                      )}`}
                    >
                      {account.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(
                        account.status
                      )}`}
                    >
                      {account.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                    {account.environment || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Account Groups */}
      <div className="bg-gray-800 rounded-lg border border-gray-700">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">Account Groups</h2>
          <p className="text-sm text-gray-400 mt-1">
            Organized collections of AWS accounts
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
          {groups.map((group) => (
            <div
              key={group.id}
              className="bg-gray-900 rounded-lg p-4 border border-gray-700 hover:border-gray-600"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-white font-medium">{group.name}</h3>
                <span className="text-xs px-2 py-1 bg-gray-800 text-gray-400 rounded">
                  {group.type}
                </span>
              </div>
              {group.description && (
                <p className="text-sm text-gray-400 mb-3">{group.description}</p>
              )}
              <div className="flex items-center text-sm text-gray-500">
                <svg
                  className="w-4 h-4 mr-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                  />
                </svg>
                {group.accounts.length} accounts
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
