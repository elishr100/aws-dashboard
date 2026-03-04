import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { securityApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Shield, AlertTriangle, CheckCircle, Loader2, Play, Download, ChevronDown, ChevronLeft, ChevronRight, Copy, ChevronUp } from 'lucide-react';
import type { SecurityFinding } from '@/types';

const AWS_REGIONS = ['us-west-2', 'us-east-1', 'eu-west-1'];

interface AuditProgress {
  phase: number;
  totalPhases: number;
  message: string;
  current: number;
  total: number;
}

interface AuditSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  score?: number;
}

interface AuditChecks {
  total: number;
  passed: number;
  failed: number;
}

export function Security() {
  const { selectedAccount } = useApp();
  const { success, error: showError } = useToast();
  const queryClient = useQueryClient();
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditProgress, setAuditProgress] = useState<AuditProgress | null>(null);
  const [streamedFindings, setStreamedFindings] = useState<SecurityFinding[]>([]);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [auditChecks, setAuditChecks] = useState<AuditChecks>({ total: 0, passed: 0, failed: 0 });
  const [completedJobId, setCompletedJobId] = useState<string | null>(null);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');
  const [filterService, setFilterService] = useState<string>('ALL');
  const [searchResource, setSearchResource] = useState<string>('');
  const [sortBy, setSortBy] = useState<'severity' | 'service' | 'resource' | 'date'>('severity');
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch findings
  const { data: findings, isLoading: loadingFindings } = useQuery({
    queryKey: ['security-findings', selectedAccount?.profile],
    queryFn: () =>
      securityApi.getFindings({
        profile: selectedAccount?.profile,
      }),
    enabled: !!selectedAccount,
  });

  // Fetch compliance report
  const { data: compliance } = useQuery({
    queryKey: ['compliance-report', selectedAccount?.profile, selectedAccount?.region],
    queryFn: () =>
      securityApi.getComplianceReport(
        selectedAccount!.profile,
        selectedAccount!.region
      ),
    enabled: !!selectedAccount,
  });

  // Load persisted audit data on mount
  useEffect(() => {
    const savedJobId = localStorage.getItem('lastAuditJobId');
    const savedSummary = localStorage.getItem('lastAuditSummary');
    const savedChecks = localStorage.getItem('lastAuditChecks');
    const savedFindings = localStorage.getItem('lastAuditFindings');

    if (savedJobId) {
      setCompletedJobId(savedJobId);
    }
    if (savedSummary) {
      try {
        setAuditSummary(JSON.parse(savedSummary));
      } catch (e) {
        console.error('Failed to parse saved audit summary', e);
      }
    }
    if (savedChecks) {
      try {
        setAuditChecks(JSON.parse(savedChecks));
      } catch (e) {
        console.error('Failed to parse saved audit checks', e);
      }
    }
    if (savedFindings) {
      try {
        setStreamedFindings(JSON.parse(savedFindings));
      } catch (e) {
        console.error('Failed to parse saved audit findings', e);
      }
    }
  }, []);

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const handleRegionToggle = (region: string) => {
    setSelectedRegions((prev) =>
      prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region]
    );
  };

  const handleStartAudit = async () => {
    if (!selectedAccount || selectedRegions.length === 0) {
      showError('Invalid Selection', 'Please select at least one region');
      return;
    }

    try {
      setIsAuditing(true);
      setAuditProgress(null);
      setStreamedFindings([]);
      setAuditSummary(null);
      setAuditChecks({ total: 0, passed: 0, failed: 0 });

      // Close existing event source if any
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      // Start the audit job
      const { jobId } = await securityApi.startAudit({
        profile: selectedAccount.profile,
        regions: selectedRegions,
      });

      console.log('[Security] Audit job started:', jobId);

      // Open SSE stream
      const eventSource = securityApi.createAuditEventSource(jobId);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[Security] SSE message:', message);

          switch (message.type) {
            case 'progress':
              setAuditProgress(message.data.progress);
              // Update summary in real-time with calculated score
              if (message.data.summary) {
                setAuditSummary(message.data.summary);
              }
              // Update checks counters in real-time
              if (message.data.checks) {
                setAuditChecks(message.data.checks);
              }
              break;

            case 'finding':
              // Add new finding to the list
              if (message.data.finding) {
                setStreamedFindings(prev => {
                  // Avoid duplicates
                  if (prev.some(f => f.id === message.data.finding.id)) {
                    return prev;
                  }
                  return [...prev, message.data.finding];
                });
              }
              break;

            case 'complete':
              console.log('[Security] Audit completed:', message.data);
              setAuditProgress(message.data.progress);
              setAuditSummary(message.data.summary);
              if (message.data.checks) {
                setAuditChecks(message.data.checks);
              }
              setIsAuditing(false);

              // Update findings with complete list
              if (message.data.findings) {
                setStreamedFindings(message.data.findings);
              }

              // Persist to localStorage
              localStorage.setItem('lastAuditJobId', jobId);
              localStorage.setItem('lastAuditSummary', JSON.stringify(message.data.summary));
              localStorage.setItem('lastAuditChecks', JSON.stringify(message.data.checks || { total: 0, passed: 0, failed: 0 }));
              localStorage.setItem('lastAuditFindings', JSON.stringify(message.data.findings || []));
              setCompletedJobId(jobId);

              success(
                'Security Audit Completed',
                `Found ${message.data.summary?.total || 0} findings. Security Score: ${message.data.summary?.score || 0}%`
              );

              // Refresh findings and compliance data
              queryClient.invalidateQueries({ queryKey: ['security-findings'] });
              queryClient.invalidateQueries({ queryKey: ['compliance-report'] });

              // Close event source
              eventSource.close();
              eventSourceRef.current = null;
              break;

            case 'error':
              console.error('[Security] Audit error:', message.data);
              showError('Audit Failed', message.data.error || 'Unknown error');
              setIsAuditing(false);
              eventSource.close();
              eventSourceRef.current = null;
              break;
          }
        } catch (error) {
          console.error('[Security] Error parsing SSE message:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('[Security] SSE error:', error);

        // Only show error if we're still auditing (not closed intentionally)
        if (isAuditing) {
          showError('Audit Stream Error', 'Connection to audit stream lost. Showing last known state.');
        }

        setIsAuditing(false);
        eventSource.close();
        eventSourceRef.current = null;
      };
    } catch (error: any) {
      console.error('[Security] Failed to start audit:', error);
      showError('Audit Failed', error.message || 'Failed to start audit');
      setIsAuditing(false);
    }
  };

  // Use streamed findings if audit is in progress or just completed, otherwise use cached findings
  const displayFindings = isAuditing || streamedFindings.length > 0 ? streamedFindings : findings || [];
  const activeFindings = displayFindings.filter((f) => f.status === 'ACTIVE');

  // Use audit summary counts if available, otherwise calculate from findings
  const criticalCount = auditSummary?.critical ?? activeFindings.filter((f) => f.severity === 'CRITICAL').length;
  const highCount = auditSummary?.high ?? activeFindings.filter((f) => f.severity === 'HIGH').length;
  const totalCount = auditSummary?.total ?? activeFindings.length;

  // Use audit summary score if available, otherwise use compliance score
  // Show "N/A" if no audit has been run yet (auditChecks.total === 0)
  const hasAuditData = auditChecks.total > 0 || auditSummary?.score !== undefined;
  const securityScore = auditSummary?.score ?? compliance?.complianceScore ?? 0;
  const scoreColor =
    securityScore >= 90
      ? 'text-green-600'
      : securityScore >= 70
      ? 'text-yellow-600'
      : 'text-red-600';

  // Helper functions
  const toggleExpandFinding = (findingId: string) => {
    setExpandedFindings((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(findingId)) {
        newSet.delete(findingId);
      } else {
        newSet.add(findingId);
      }
      return newSet;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    success('Copied', 'ARN copied to clipboard');
  };

  // Filter and sort findings
  const filteredFindings = activeFindings.filter((finding) => {
    if (filterSeverity !== 'ALL' && finding.severity !== filterSeverity) return false;
    if (filterService !== 'ALL' && finding.resourceType !== filterService) return false;
    if (searchResource && !finding.resourceName?.toLowerCase().includes(searchResource.toLowerCase()) &&
        !finding.resourceId.toLowerCase().includes(searchResource.toLowerCase())) return false;
    return true;
  });

  // Sort findings
  const sortedFindings = [...filteredFindings].sort((a, b) => {
    if (sortBy === 'severity') {
      const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
      return (severityOrder[a.severity as keyof typeof severityOrder] || 99) -
             (severityOrder[b.severity as keyof typeof severityOrder] || 99);
    } else if (sortBy === 'service') {
      return (a.resourceType || '').localeCompare(b.resourceType || '');
    } else if (sortBy === 'resource') {
      return (a.resourceName || a.resourceId).localeCompare(b.resourceName || b.resourceId);
    } else if (sortBy === 'date') {
      return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
    }
    return 0;
  });

  // Pagination
  const itemsPerPage = 25;
  const totalPages = Math.ceil(sortedFindings.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedFindings = sortedFindings.slice(startIndex, endIndex);

  // Get unique services for filter
  const uniqueServices = Array.from(new Set(activeFindings.map((f) => f.resourceType).filter(Boolean)));

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterSeverity, filterService, searchResource]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Security Dashboard</h1>
        <p className="text-muted-foreground">
          AWS security posture and compliance monitoring
        </p>
      </div>

      {/* Security Score */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Security Score</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${hasAuditData ? scoreColor : 'text-gray-400'}`}>
              {hasAuditData ? `${securityScore.toFixed(0)}%` : 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">
              {!hasAuditData
                ? 'Run audit to calculate'
                : securityScore >= 90
                ? 'Excellent'
                : securityScore >= 70
                ? 'Good'
                : 'Needs Attention'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{criticalCount}</div>
            <p className="text-xs text-muted-foreground">Requires immediate action</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Priority</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{highCount}</div>
            <p className="text-xs text-muted-foreground">Should be addressed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Findings</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCount}</div>
            <p className="text-xs text-muted-foreground">Active security findings</p>
          </CardContent>
        </Card>
      </div>

      {/* Start Audit */}
      <Card>
        <CardHeader>
          <CardTitle>Run Security Audit</CardTitle>
          <CardDescription>
            Scan AWS resources for security vulnerabilities and compliance issues
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Select Regions</label>
            <div className="flex gap-2">
              {AWS_REGIONS.map((region) => (
                <label
                  key={region}
                  className="flex items-center gap-2 rounded-lg border p-3 cursor-pointer hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={selectedRegions.includes(region)}
                    onChange={() => handleRegionToggle(region)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm">{region}</span>
                </label>
              ))}
            </div>
          </div>

          <Button
            onClick={handleStartAudit}
            disabled={isAuditing || selectedRegions.length === 0}
            className="w-full"
          >
            {isAuditing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running Audit...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Start Security Audit
              </>
            )}
          </Button>

          {/* Audit Progress */}
          {isAuditing && auditProgress && (
            <div className="mt-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{auditProgress.message}</span>
                <span className="text-muted-foreground">
                  Phase {auditProgress.phase}/{auditProgress.totalPhases}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${auditProgress.current}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{streamedFindings.length} findings discovered</span>
                <span>{auditProgress.current}% complete</span>
              </div>
            </div>
          )}

          {/* Download Report Button */}
          {completedJobId && !isAuditing && (
            <div className="mt-4 relative">
              <Button
                onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                variant="outline"
                className="w-full"
              >
                <Download className="mr-2 h-4 w-4" />
                Download Report
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
              {showDownloadMenu && (
                <div className="absolute z-10 mt-2 w-full rounded-md border bg-white shadow-lg">
                  <div className="py-1">
                    <button
                      onClick={() => {
                        securityApi.downloadReport(completedJobId, 'json', selectedAccount?.profile);
                        setShowDownloadMenu(false);
                      }}
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-accent"
                    >
                      Download JSON
                    </button>
                    <button
                      onClick={() => {
                        securityApi.downloadReport(completedJobId, 'csv', selectedAccount?.profile);
                        setShowDownloadMenu(false);
                      }}
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-accent"
                    >
                      Download CSV
                    </button>
                    <button
                      onClick={() => {
                        securityApi.downloadReport(completedJobId, 'pdf', selectedAccount?.profile);
                        setShowDownloadMenu(false);
                      }}
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-accent"
                    >
                      Download PDF
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* All Findings with Filters and Pagination */}
      <Card>
        <CardHeader>
          <CardTitle>Security Findings</CardTitle>
          <CardDescription>
            {isAuditing
              ? 'Discovering security issues in real-time...'
              : `${sortedFindings.length} findings discovered in your AWS environment`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingFindings && !isAuditing ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : activeFindings.length === 0 && !isAuditing ? (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No active security findings</p>
              <p className="text-sm">Run a security audit to discover issues</p>
            </div>
          ) : (
            <>
              {/* Filter Bar */}
              <div className="mb-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {/* Severity Filter */}
                  <div>
                    <label className="text-xs font-medium mb-1 block">Severity</label>
                    <select
                      value={filterSeverity}
                      onChange={(e) => setFilterSeverity(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="ALL">All Severities</option>
                      <option value="CRITICAL">Critical</option>
                      <option value="HIGH">High</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="LOW">Low</option>
                    </select>
                  </div>

                  {/* Service Filter */}
                  <div>
                    <label className="text-xs font-medium mb-1 block">Service</label>
                    <select
                      value={filterService}
                      onChange={(e) => setFilterService(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="ALL">All Services</option>
                      {uniqueServices.sort().map((service) => (
                        <option key={service} value={service}>
                          {service}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Sort By */}
                  <div>
                    <label className="text-xs font-medium mb-1 block">Sort By</label>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="severity">Severity</option>
                      <option value="service">Service</option>
                      <option value="resource">Resource Name</option>
                      <option value="date">Date Detected</option>
                    </select>
                  </div>

                  {/* Search */}
                  <div>
                    <label className="text-xs font-medium mb-1 block">Search Resource</label>
                    <input
                      type="text"
                      placeholder="Search by resource name or ID"
                      value={searchResource}
                      onChange={(e) => setSearchResource(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {/* Results count */}
                <div className="text-sm text-muted-foreground">
                  Showing {startIndex + 1}-{Math.min(endIndex, sortedFindings.length)} of {sortedFindings.length} findings
                </div>
              </div>

              {/* Findings List */}
              <div className="space-y-2">
                {paginatedFindings.map((finding) => {
                  const isExpanded = expandedFindings.has(finding.id);
                  const arn: string = finding.metadata?.arn as string || `arn:aws:${finding.resourceType?.toLowerCase()}:${finding.region}:${selectedAccount?.accountId || 'unknown'}:${finding.resourceId}`;

                  return (
                    <div
                      key={finding.id}
                      className="rounded-lg border overflow-hidden"
                    >
                      <div
                        className="flex items-start gap-3 p-3 hover:bg-accent cursor-pointer"
                        onClick={() => toggleExpandFinding(finding.id)}
                      >
                        <div className="flex-shrink-0">
                          {finding.severity === 'CRITICAL' && (
                            <AlertTriangle className="h-5 w-5 text-red-600" />
                          )}
                          {finding.severity === 'HIGH' && (
                            <AlertTriangle className="h-5 w-5 text-orange-600" />
                          )}
                          {finding.severity === 'MEDIUM' && (
                            <AlertTriangle className="h-5 w-5 text-yellow-600" />
                          )}
                          {finding.severity === 'LOW' && (
                            <AlertTriangle className="h-5 w-5 text-blue-600" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{finding.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {finding.resourceType} • {finding.resourceName || finding.resourceId} • {finding.region}
                          </p>
                          {!isExpanded && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{finding.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                              finding.severity === 'CRITICAL'
                                ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20'
                                : finding.severity === 'HIGH'
                                ? 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/20'
                                : finding.severity === 'MEDIUM'
                                ? 'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-600/20'
                                : 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20'
                            }`}
                          >
                            {finding.severity}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="border-t bg-gray-50 p-4 space-y-3">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Resource ARN</p>
                            <div className="flex items-center gap-2">
                              <code className="text-xs bg-white px-2 py-1 rounded border flex-1">{arn}</code>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(arn);
                                }}
                                className="p-1 hover:bg-white rounded"
                              >
                                <Copy className="h-4 w-4 text-muted-foreground" />
                              </button>
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                            <p className="text-sm">{finding.description}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Recommendation</p>
                            <p className="text-sm">{finding.recommendation}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Detected At</p>
                            <p className="text-sm">{new Date(finding.detectedAt).toLocaleString()}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </button>
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Compliance Summary */}
      {(compliance || auditChecks.total > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Compliance Status</CardTitle>
              <CardDescription>Security checks passed vs failed</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm">Total Checks</span>
                  <span className="text-sm font-medium">
                    {auditChecks.total > 0 ? auditChecks.total : compliance?.totalChecks || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Passed</span>
                  <span className="text-sm font-medium text-green-600">
                    {auditChecks.total > 0 ? auditChecks.passed : compliance?.passedChecks || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Failed</span>
                  <span className="text-sm font-medium text-red-600">
                    {auditChecks.total > 0 ? auditChecks.failed : compliance?.failedChecks || 0}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Severity Breakdown</CardTitle>
              <CardDescription>Findings by risk level</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm">Critical</span>
                  <span className="text-sm font-medium text-red-600">
                    {auditSummary?.critical ?? compliance?.findingsBySeverity.critical ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">High</span>
                  <span className="text-sm font-medium text-orange-600">
                    {auditSummary?.high ?? compliance?.findingsBySeverity.high ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Medium</span>
                  <span className="text-sm font-medium text-yellow-600">
                    {auditSummary?.medium ?? compliance?.findingsBySeverity.medium ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Low</span>
                  <span className="text-sm font-medium text-blue-600">
                    {auditSummary?.low ?? compliance?.findingsBySeverity.low ?? 0}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
