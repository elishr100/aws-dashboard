import { useQuery } from '@tanstack/react-query';
import { useApp } from '@/context/AppContext';
import { resourcesApi, costApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Database, Server, Cloud, HardDrive, Loader2, DollarSign, TrendingUp } from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

const CHART_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export function Dashboard() {
  const { accounts, selectedAccount } = useApp();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['resource-stats', selectedAccount?.profile, selectedAccount?.region],
    queryFn: async () => {
      try {
        return await resourcesApi.getStats({
          profile: selectedAccount?.profile || accounts[0]?.profile,
          region: selectedAccount?.region || accounts[0]?.region || 'us-west-2',
        });
      } catch (err) {
        // Handle 404 as "no data yet" instead of an error
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('404') || errorMessage.includes('No resources found')) {
          return { total: 0, byType: {}, byRegion: {}, byProfile: {} };
        }
        throw err;
      }
    },
    enabled: accounts.length > 0,
    retry: false, // Don't retry 404s
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: costSummary } = useQuery({
    queryKey: ['cost-dashboard', selectedAccount?.profile],
    queryFn: async () => {
      if (!selectedAccount?.profile) return null;
      try {
        return await costApi.getDashboardSummary(selectedAccount.profile);
      } catch (err) {
        // Cost data is optional
        console.warn('Failed to fetch cost summary:', err);
        return null;
      }
    },
    enabled: !!selectedAccount?.profile,
    refetchInterval: 300000, // 5 minutes
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const resourceTypes = stats?.byType || {};
  const totalResources = stats?.total || 0;
  const hasNoResources = totalResources === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          {hasNoResources
            ? 'Run a scan to see resources'
            : `Overview of your AWS resources across ${accounts.length} accounts`}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Resources</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalResources}</div>
            <p className="text-xs text-muted-foreground">
              Across all accounts
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">EC2 Instances</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{resourceTypes['EC2'] || 0}</div>
            <p className="text-xs text-muted-foreground">
              Running instances
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">VPCs</CardTitle>
            <Cloud className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{resourceTypes['VPC'] || 0}</div>
            <p className="text-xs text-muted-foreground">
              Virtual networks
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">S3 Buckets</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{resourceTypes['S3'] || 0}</div>
            <p className="text-xs text-muted-foreground">
              Storage buckets
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Month Spend</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${costSummary?.totalCurrentMonth.toFixed(2) || '0.00'}
            </div>
            <p className="text-xs text-muted-foreground">
              {costSummary?.currency || 'USD'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Projected Month End</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${costSummary?.projectedMonthEnd.toFixed(2) || '0.00'}
            </div>
            <p className="text-xs text-muted-foreground">
              Forecast based on current usage
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cost Notes (e.g., Bedrock billing info) */}
      {costSummary?.notes && costSummary.notes.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="text-yellow-800">Cost Information</CardTitle>
            <CardDescription className="text-yellow-700">
              Important notes about cost allocation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {costSummary.notes.map((note, idx) => (
                <div key={idx} className="text-sm text-yellow-800">
                  {note}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cost breakdown charts */}
      {costSummary && costSummary.topExpensiveResources.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Cost by Service Type</CardTitle>
              <CardDescription>Distribution of costs across AWS services</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={Object.entries(
                      costSummary.topExpensiveResources.reduce((acc, r) => {
                        acc[r.resourceType] = (acc[r.resourceType] || 0) + r.cost;
                        return acc;
                      }, {} as Record<string, number>)
                    ).map(([name, value]) => ({ name, value }))}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {Object.keys(
                      costSummary.topExpensiveResources.reduce((acc, r) => {
                        acc[r.resourceType] = true;
                        return acc;
                      }, {} as Record<string, boolean>)
                    ).map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top 5 Most Expensive Resources</CardTitle>
              <CardDescription>Highest costs this month</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={costSummary.topExpensiveResources}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="resourceName"
                    tick={{ fontSize: 10 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis />
                  <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                  <Bar dataKey="cost" fill="#8884d8" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top 5 Expensive Resources Table */}
      {costSummary && costSummary.topExpensiveResources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top 5 Most Expensive Resources</CardTitle>
            <CardDescription>Highest costs this month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">ID</th>
                    <th className="pb-2 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {costSummary.topExpensiveResources.map((r) => (
                    <tr key={r.resourceId} className="border-b last:border-0">
                      <td className="py-2">
                        <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                          {r.resourceType}
                        </span>
                      </td>
                      <td className="py-2">{r.resourceName || '-'}</td>
                      <td className="py-2 text-xs text-muted-foreground">{r.resourceId}</td>
                      <td className="py-2 text-right font-semibold">${r.cost.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resource by Type */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Resources by Type</CardTitle>
            <CardDescription>
              Distribution of resources across AWS services
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(resourceTypes).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{type}</span>
                  <span className="text-sm text-muted-foreground">{count}</span>
                </div>
              ))}
              {Object.keys(resourceTypes).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No resources found. Start a scan to discover resources.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resources by Region</CardTitle>
            <CardDescription>
              Geographic distribution of resources
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(stats?.byRegion || {}).map(([region, count]) => (
                <div key={region} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{region}</span>
                  <span className="text-sm text-muted-foreground">{count}</span>
                </div>
              ))}
              {Object.keys(stats?.byRegion || {}).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No resources found. Start a scan to discover resources.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Accounts Overview */}
      <Card>
        <CardHeader>
          <CardTitle>AWS Accounts</CardTitle>
          <CardDescription>
            {accounts.length} accounts configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {accounts.slice(0, 9).map((account) => (
              <div
                key={`${account.profile}-${account.region}`}
                className="flex items-center gap-2 rounded-lg border p-3"
              >
                <Cloud className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{account.profile}</p>
                  <p className="text-xs text-muted-foreground">{account.region}</p>
                </div>
              </div>
            ))}
          </div>
          {accounts.length > 9 && (
            <p className="mt-4 text-sm text-muted-foreground">
              And {accounts.length - 9} more accounts...
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
