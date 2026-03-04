import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../lib/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';

export default function Analytics() {

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: () => analyticsApi.getSummary(),
    refetchInterval: 60000,
  });

  const { data: trends, isLoading: trendsLoading } = useQuery({
    queryKey: ['analytics-trends'],
    queryFn: () => analyticsApi.getTrends(),
    refetchInterval: 300000, // 5 minutes
  });

  const { data: costAllocation } = useQuery({
    queryKey: ['analytics-cost-allocation'],
    queryFn: () => analyticsApi.getCostAllocation('service'),
    refetchInterval: 60000,
  });

  if (summaryLoading || trendsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading analytics data...</div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'EXCELLENT':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'GOOD':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'FAIR':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'POOR':
        return 'text-red-600 bg-red-50 border-red-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Organization Analytics</h1>
        <p className="text-gray-400">
          Cross-account aggregation, comparison, and analytics
        </p>
      </div>

      {/* Executive Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Accounts</p>
              <p className="text-3xl font-bold text-white mt-1">
                {summary?.overview.totalAccounts || 0}
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
            Resources: {summary?.overview.totalResources || 0}
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Cost</p>
              <p className="text-3xl font-bold text-white mt-1">
                {formatCurrency(summary?.overview.totalCost || 0)}
              </p>
            </div>
            <div className="text-green-500">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
          <div className="mt-4 text-sm">
            <span className={`px-2 py-1 rounded text-xs ${
              summary?.costs.trend === 'INCREASING' ? 'bg-red-900 text-red-200' :
              summary?.costs.trend === 'DECREASING' ? 'bg-green-900 text-green-200' :
              'bg-gray-700 text-gray-300'
            }`}>
              {summary?.costs.trend || 'STABLE'}
            </span>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Security Score</p>
              <p className="text-3xl font-bold text-white mt-1">
                {summary?.security.overallScore || 0}%
              </p>
            </div>
            <div className="text-purple-500">
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
          <div className="mt-4">
            <span className={`px-2 py-1 rounded text-xs border ${getStatusColor(summary?.security.status || 'FAIR')}`}>
              {summary?.security.status || 'FAIR'}
            </span>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Compliance Score</p>
              <p className="text-3xl font-bold text-white mt-1">
                {summary?.compliance.overallScore || 0}%
              </p>
            </div>
            <div className="text-indigo-500">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
          </div>
          <div className="mt-4">
            <span className={`px-2 py-1 rounded text-xs border ${getStatusColor(summary?.compliance.status || 'FAIR')}`}>
              {summary?.compliance.status || 'FAIR'}
            </span>
          </div>
        </div>
      </div>

      {/* Cost Trends Chart */}
      <div className="bg-gray-800 rounded-lg border border-gray-700">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">Cost Trends (Last 30 Days)</h2>
          <p className="text-sm text-gray-400 mt-1">Daily cost across all accounts</p>
        </div>
        <div className="p-6">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trends?.costs.daily || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="date" stroke="#9CA3AF" />
              <YAxis stroke="#9CA3AF" tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                labelStyle={{ color: '#F3F4F6' }}
                formatter={(value: number) => [`${formatCurrency(value)}`, 'Cost']}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#3B82F6"
                strokeWidth={2}
                dot={false}
                name="Daily Cost"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost by Service */}
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="p-6 border-b border-gray-700">
            <h2 className="text-xl font-semibold text-white">Cost by Service</h2>
            <p className="text-sm text-gray-400 mt-1">Top spending AWS services</p>
          </div>
          <div className="p-6">
            {costAllocation?.breakdown ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={costAllocation.breakdown.slice(0, 5)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                    labelStyle={{ color: '#F3F4F6' }}
                    formatter={(value: number) => [formatCurrency(value), 'Cost']}
                  />
                  <Bar dataKey="cost" fill="#10B981" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-gray-400 text-center py-8">No data available</div>
            )}
          </div>
        </div>

        {/* Security & Compliance Trends */}
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="p-6 border-b border-gray-700">
            <h2 className="text-xl font-semibold text-white">Security & Compliance Trends</h2>
            <p className="text-sm text-gray-400 mt-1">Weekly scores over time</p>
          </div>
          <div className="p-6">
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trends?.security.weekly || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                  labelStyle={{ color: '#F3F4F6' }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#8B5CF6"
                  strokeWidth={2}
                  dot={false}
                  name="Security Score"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Spenders */}
      {summary?.costs?.topSpenders && summary.costs.topSpenders.length > 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="p-6 border-b border-gray-700">
            <h2 className="text-xl font-semibold text-white">Top Spending Accounts</h2>
            <p className="text-sm text-gray-400 mt-1">Accounts with highest costs</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Rank
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Account ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Cost
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    % of Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {summary.costs.topSpenders.map((spender: { accountId: string; cost: number; percentage: number }, index: number) => (
                  <tr key={spender.accountId} className="hover:bg-gray-750">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      #{index + 1}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                      {spender.accountId}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      {formatCurrency(spender.cost)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      {((spender.cost / summary.costs.total) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
