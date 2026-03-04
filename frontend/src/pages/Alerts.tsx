import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { securityApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Bell, Check, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import type { SecurityAlert, FindingSeverity } from '@/types';

export function Alerts() {
  const { selectedAccount } = useApp();
  const { success, error: showError } = useToast();
  const queryClient = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'ALL'>('ALL');
  const [acknowledgedFilter, setAcknowledgedFilter] = useState<'ALL' | 'ACKNOWLEDGED' | 'UNACKNOWLEDGED'>('ALL');

  // Fetch alerts
  const { data: alerts, isLoading } = useQuery({
    queryKey: ['security-alerts', selectedAccount?.profile, severityFilter, acknowledgedFilter],
    queryFn: () =>
      securityApi.getAlerts({
        profile: selectedAccount?.profile,
        severity: severityFilter === 'ALL' ? undefined : severityFilter,
        acknowledged:
          acknowledgedFilter === 'ALL'
            ? undefined
            : acknowledgedFilter === 'ACKNOWLEDGED',
      }),
    enabled: !!selectedAccount,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch alert stats
  const { data: stats } = useQuery({
    queryKey: ['alert-stats'],
    queryFn: securityApi.getAlertStats,
    refetchInterval: 30000,
  });

  // Acknowledge alert mutation
  const acknowledgeMutation = useMutation({
    mutationFn: (alertId: string) => securityApi.acknowledgeAlert(alertId),
    onSuccess: () => {
      success('Alert Acknowledged', 'The alert has been marked as acknowledged');
      queryClient.invalidateQueries({ queryKey: ['security-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
    },
    onError: (err: Error) => {
      showError('Failed to Acknowledge', err.message);
    },
  });

  // Delete alert mutation
  const deleteMutation = useMutation({
    mutationFn: (alertId: string) => securityApi.deleteAlert(alertId),
    onSuccess: () => {
      success('Alert Deleted', 'The alert has been removed');
      queryClient.invalidateQueries({ queryKey: ['security-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
    },
    onError: (err: Error) => {
      showError('Failed to Delete', err.message);
    },
  });

  // Real-time alert stream
  useEffect(() => {
    const eventSource = securityApi.createAlertStream();

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'alert') {
        const alert: SecurityAlert = data.data;
        showError(
          `New ${alert.severity} Alert`,
          alert.title,
        );
        queryClient.invalidateQueries({ queryKey: ['security-alerts'] });
        queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
      }
    };

    eventSource.onerror = () => {
      console.error('Alert stream connection lost');
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [queryClient, showError]);

  const handleAcknowledge = (alertId: string) => {
    acknowledgeMutation.mutate(alertId);
  };

  const handleDelete = (alertId: string) => {
    deleteMutation.mutate(alertId);
  };

  const filteredAlerts = alerts || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Security Alerts</h1>
          <p className="text-muted-foreground">
            Real-time security notifications and alerts
          </p>
        </div>
      </div>

      {/* Alert Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Alerts</CardTitle>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
            <p className="text-xs text-muted-foreground">All security alerts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unacknowledged</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {stats?.unacknowledged || 0}
            </div>
            <p className="text-xs text-muted-foreground">Requires attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {stats?.bySeverity?.CRITICAL || 0}
            </div>
            <p className="text-xs text-muted-foreground">Critical alerts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {stats?.bySeverity?.HIGH || 0}
            </div>
            <p className="text-xs text-muted-foreground">High priority</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filter Alerts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Severity</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as FindingSeverity | 'ALL')}
              >
                <option value="ALL">All Severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Status</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={acknowledgedFilter}
                onChange={(e) => setAcknowledgedFilter(e.target.value as 'ALL' | 'ACKNOWLEDGED' | 'UNACKNOWLEDGED')}
              >
                <option value="ALL">All Alerts</option>
                <option value="UNACKNOWLEDGED">Unacknowledged</option>
                <option value="ACKNOWLEDGED">Acknowledged</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerts List */}
      <Card>
        <CardHeader>
          <CardTitle>Alerts ({filteredAlerts.length})</CardTitle>
          <CardDescription>
            Security alerts sorted by severity and creation time
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No alerts found</p>
              <p className="text-sm">Run a security audit to generate alerts</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 rounded-lg border p-4 ${
                    alert.acknowledged ? 'opacity-60 bg-muted/30' : 'bg-background'
                  }`}
                >
                  <div className="flex-shrink-0 mt-1">
                    <AlertTriangle
                      className={`h-5 w-5 ${
                        alert.severity === 'CRITICAL'
                          ? 'text-red-600'
                          : alert.severity === 'HIGH'
                          ? 'text-orange-600'
                          : alert.severity === 'MEDIUM'
                          ? 'text-yellow-600'
                          : 'text-blue-600'
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{alert.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {alert.profile} • {alert.region} • {alert.resourceId}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                            alert.severity === 'CRITICAL'
                              ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20'
                              : alert.severity === 'HIGH'
                              ? 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/20'
                              : alert.severity === 'MEDIUM'
                              ? 'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-600/20'
                              : 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20'
                          }`}
                        >
                          {alert.severity}
                        </span>
                        {alert.acknowledged && (
                          <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                            Acknowledged
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">
                      {alert.message}
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                      {!alert.acknowledged && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAcknowledge(alert.id)}
                          disabled={acknowledgeMutation.isPending}
                        >
                          <Check className="mr-1 h-3 w-3" />
                          Acknowledge
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(alert.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Delete
                      </Button>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(alert.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
