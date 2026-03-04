import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { resourcesApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2, Search, Filter, ScanLine } from 'lucide-react';

// Helper functions for cost display
const getCostBadgeColor = (cost?: number) => {
  if (!cost || cost === 0) return 'bg-gray-50 text-gray-700 ring-1 ring-inset ring-gray-600/20';
  if (cost < 10) return 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20';
  if (cost < 100) return 'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-600/20';
  return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20';
};

const formatCost = (cost?: number, _currency?: string) => {
  if (cost === undefined || cost === null) return '-';
  return `$${cost.toFixed(2)}`;
};

export function Resources() {
  const { selectedAccount } = useApp();
  const navigate = useNavigate();

  // Client-side filter state (not used for API calls)
  const [clientFilters, setClientFilters] = useState({
    type: '',
    vpcId: '',
    region: '',
  });

  // Fetch ALL resources using only profile and region from AppContext
  const { data: resourcesData, isLoading, refetch } = useQuery({
    queryKey: ['resources', selectedAccount?.profile, selectedAccount?.region],
    queryFn: async () => {
      if (!selectedAccount?.profile || !selectedAccount?.region) {
        return null;
      }
      try {
        const response = await resourcesApi.getAll({
          profile: selectedAccount.profile,
          region: selectedAccount.region,
        });
        return response;
      } catch (err) {
        // Return null for 404 (no cache data)
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('404') || errorMessage.includes('No resources found')) {
          return null;
        }
        throw err;
      }
    },
    enabled: !!selectedAccount?.profile && !!selectedAccount?.region,
    retry: false,
  });

  // Extract all resources from response - memoized to prevent recreation on every render
  const allResources = useMemo(() => {
    if (!resourcesData) return [];
    if (Array.isArray(resourcesData)) return resourcesData;
    return resourcesData.resources || [];
  }, [resourcesData]);

  // Apply client-side filtering
  const filteredResources = useMemo(() => {
    let filtered = [...allResources];

    if (clientFilters.type) {
      filtered = filtered.filter(r => r.type === clientFilters.type);
    }
    if (clientFilters.vpcId) {
      filtered = filtered.filter(r => r.vpcId === clientFilters.vpcId);
    }
    if (clientFilters.region) {
      filtered = filtered.filter(r => r.region === clientFilters.region);
    }

    return filtered;
  }, [allResources, clientFilters]);

  // Extract unique values for dropdowns from ALL fetched resources
  const resourceTypes = useMemo<string[]>(() =>
    [...new Set(allResources.map((r) => r.type))].sort(),
    [allResources]
  );
  const regions = useMemo<string[]>(() =>
    [...new Set(allResources.map((r) => r.region))].sort(),
    [allResources]
  );
  const vpcIds = useMemo<string[]>(() =>
    [...new Set(allResources.map((r) => r.vpcId).filter((id): id is string => Boolean(id)))].sort(),
    [allResources]
  );

  const handleFilterChange = (key: string, value: string) => {
    setClientFilters((prev) => ({ ...prev, [key]: value }));
  };

  // Clear only client-side filters (NOT profile/region from AppContext)
  const clearFilters = () => {
    setClientFilters({
      type: '',
      vpcId: '',
      region: '',
    });
  };

  const hasActiveFilters = clientFilters.type || clientFilters.vpcId || clientFilters.region;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resources</h1>
          <p className="text-muted-foreground">
            Discover and manage AWS resources
          </p>
        </div>
        <Button onClick={() => refetch()}>
          <Search className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filters
              </CardTitle>
              <CardDescription>
                Filter resources by type, region, or VPC
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
            >
              Clear Filters
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="text-sm font-medium mb-2 block">Type</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={clientFilters.type}
                onChange={(e) => handleFilterChange('type', e.target.value)}
              >
                <option value="">All types</option>
                {resourceTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Region</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={clientFilters.region}
                onChange={(e) => handleFilterChange('region', e.target.value)}
              >
                <option value="">All regions</option>
                {regions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">VPC ID</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={clientFilters.vpcId}
                onChange={(e) => handleFilterChange('vpcId', e.target.value)}
              >
                <option value="">All VPCs</option>
                {vpcIds.map((vpcId) => (
                  <option key={vpcId} value={vpcId}>
                    {vpcId}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resources Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Resources ({hasActiveFilters ? `${filteredResources.length} of ${allResources.length}` : allResources.length})
          </CardTitle>
          <CardDescription>
            {selectedAccount
              ? `AWS resources in ${selectedAccount.profile} (${selectedAccount.region})`
              : 'Select an account to view resources'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : resourcesData === null ? (
            <div className="flex h-32 flex-col items-center justify-center gap-4">
              <p className="text-muted-foreground">
                No scan data found for {selectedAccount?.profile} in {selectedAccount?.region}
              </p>
              <Button onClick={() => navigate('/scan')}>
                <ScanLine className="mr-2 h-4 w-4" />
                Go to Scan Page
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="pb-3 font-medium w-[80px]">Type</th>
                    <th className="pb-3 font-medium w-[250px]">Name</th>
                    <th className="pb-3 font-medium w-[150px]">ID</th>
                    <th className="pb-3 font-medium w-[100px]">Region</th>
                    <th className="pb-3 font-medium w-[100px]">State</th>
                    <th className="pb-3 font-medium text-right w-[140px]">Current Month Cost</th>
                    <th className="pb-3 font-medium text-right w-[130px]">Avg Cost/Month</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResources && filteredResources.length > 0 ? (
                    filteredResources.map((resource) => (
                      <tr key={resource.id} className="border-b last:border-0">
                        <td className="py-3 w-[80px]">
                          <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                            {resource.type}
                          </span>
                        </td>
                        <td className="py-3 font-medium w-[250px] truncate" title={resource.name || '-'}>
                          {resource.name || '-'}
                        </td>
                        <td className="py-3 text-muted-foreground w-[150px]" title={resource.id}>
                          <span className="block truncate">
                            {resource.id.length > 20 ? `${resource.id.substring(0, 20)}...` : resource.id}
                          </span>
                        </td>
                        <td className="py-3 w-[100px]">{resource.region}</td>
                        <td className="py-3 w-[100px]">
                          {resource.state && (
                            <span
                              className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                                resource.state === 'running' || resource.state === 'available'
                                  ? 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20'
                                  : 'bg-gray-50 text-gray-700 ring-1 ring-inset ring-gray-600/20'
                              }`}
                            >
                              {resource.state}
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-right w-[140px]">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${getCostBadgeColor(
                              resource.cost?.currentMonthCost
                            )}`}
                          >
                            {formatCost(resource.cost?.currentMonthCost, resource.cost?.currency)}
                          </span>
                        </td>
                        <td className="py-3 text-right w-[130px] text-muted-foreground">
                          {formatCost(resource.cost?.avgMonthlyCost, resource.cost?.currency)}
                        </td>
                      </tr>
                    ))
                  ) : hasActiveFilters ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        No resources match the current filters. Try adjusting your filters.
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        No resources found. Start a scan to discover resources.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
