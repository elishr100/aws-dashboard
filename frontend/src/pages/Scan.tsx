import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { scanApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2, ScanLine, CheckCircle, XCircle } from 'lucide-react';
import type { ScanJob, ScanProgressEvent } from '@/types';

const AWS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
];

export function Scan() {
  const { selectedAccount } = useApp();
  const navigate = useNavigate();
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanJob, setScanJob] = useState<ScanJob | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedResources, setCompletedResources] = useState<number>(0);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);

  const handleRegionToggle = (region: string) => {
    setSelectedRegions((prev) =>
      prev.includes(region)
        ? prev.filter((r) => r !== region)
        : [...prev, region]
    );
  };

  const handleSelectAll = () => {
    if (selectedRegions.length === AWS_REGIONS.length) {
      setSelectedRegions([]);
    } else {
      setSelectedRegions(AWS_REGIONS);
    }
  };

  // Auto-redirect countdown effect
  useEffect(() => {
    if (redirectCountdown === null) return;

    if (redirectCountdown === 0) {
      navigate('/');
      return;
    }

    const timer = setTimeout(() => {
      setRedirectCountdown(redirectCountdown - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [redirectCountdown, navigate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, []);

  const checkJobStatus = async (jobId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/scan/${jobId}/status`);
      const data = await response.json();

      if (data.success && data.status === 'completed') {
        // Scan completed successfully
        setCompletedResources(data.resourcesFound || 0);
        setIsScanning(false);
        setProgress({
          current: 100,
          total: 100,
          message: `Scan completed - ${data.resourcesFound} resources found`,
        });
        // Start redirect countdown
        setRedirectCountdown(3);
        return true;
      }

      return false;
    } catch (err) {
      console.error('Failed to check job status:', err);
      return false;
    }
  };

  const connectToStream = (jobId: string) => {
    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Clear any pending reconnection
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    console.log(`Connecting to SSE stream for job ${jobId}, attempt ${reconnectAttemptsRef.current + 1}`);

    const eventSource = scanApi.createEventSource(jobId);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('SSE connection opened');
      reconnectAttemptsRef.current = 0; // Reset counter on successful connection
    };

    eventSource.onmessage = (event) => {
      const data: ScanProgressEvent = JSON.parse(event.data);

      if (data.type === 'progress') {
        setProgress({
          current: data.data.progress?.current || 0,
          total: data.data.progress?.total || 0,
          message: data.data.message,
        });
      } else if (data.type === 'complete') {
        setProgress({
          current: data.data.progress?.total || 0,
          total: data.data.progress?.total || 0,
          message: data.data.message,
        });
        setCompletedResources(data.data.resources?.length || 0);
        setIsScanning(false);
        eventSource.close();
        eventSourceRef.current = null;
        // Start redirect countdown
        setRedirectCountdown(3);
      } else if (data.type === 'error') {
        setError(data.data.error || 'Scan failed');
        setIsScanning(false);
        eventSource.close();
        eventSourceRef.current = null;
      }
    };

    eventSource.onerror = async () => {
      console.log('SSE connection error');
      eventSource.close();
      eventSourceRef.current = null;

      // Check if scan completed successfully before showing error
      const completed = await checkJobStatus(jobId);

      if (!completed && isScanning) {
        // Scan is still in progress, try to reconnect after 5 seconds
        reconnectAttemptsRef.current++;
        console.log(`Will retry connection in 5 seconds (attempt ${reconnectAttemptsRef.current})`);

        reconnectTimeoutRef.current = setTimeout(() => {
          connectToStream(jobId);
        }, 5000);
      } else if (!completed) {
        // Scan failed or was stopped
        setError('Connection to scan stream lost');
        setIsScanning(false);
      }
    };
  };

  const handleStartScan = async () => {
    if (!selectedAccount || selectedRegions.length === 0) {
      setError('Please select at least one region');
      return;
    }

    setIsScanning(true);
    setError(null);
    setProgress(null);
    setCompletedResources(0);
    setRedirectCountdown(null);
    reconnectAttemptsRef.current = 0;

    try {
      const job = await scanApi.start({
        profile: selectedAccount.profile,
        regions: selectedRegions,
      });

      setScanJob(job);
      connectToStream(job.jobId);
    } catch (err) {
      console.error('Failed to start scan:', err);
      setError('Failed to start scan');
      setIsScanning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Resource Scanner</h1>
        <p className="text-muted-foreground">
          Scan AWS accounts and regions to discover resources
        </p>
      </div>

      {/* Account and Region Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Scan Configuration</CardTitle>
          <CardDescription>
            Select regions to scan for {selectedAccount?.profile || 'No account selected'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium">Regions</label>
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                {selectedRegions.length === AWS_REGIONS.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
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
            className="w-full"
            onClick={handleStartScan}
            disabled={isScanning || selectedRegions.length === 0}
          >
            {isScanning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <ScanLine className="mr-2 h-4 w-4" />
                Start Scan
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Scan Progress */}
      {(isScanning || progress || error) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isScanning && <Loader2 className="h-5 w-5 animate-spin" />}
              {!isScanning && !error && <CheckCircle className="h-5 w-5 text-green-600" />}
              {error && <XCircle className="h-5 w-5 text-destructive" />}
              Scan Progress
            </CardTitle>
            <CardDescription>
              {scanJob ? `Job ID: ${scanJob.jobId}` : 'Initializing...'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive p-4">
                <p className="text-sm text-destructive font-medium">{error}</p>
              </div>
            )}

            {progress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{progress.message}</span>
                  <span className="font-medium">
                    {progress.current} / {progress.total}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-secondary">
                  <div
                    className="h-2 rounded-full bg-primary transition-all"
                    style={{
                      width: `${(progress.current / progress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {!isScanning && !error && completedResources > 0 && (
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <p className="text-sm text-green-800 font-medium">
                  Scan completed - {completedResources} resources found
                </p>
                {redirectCountdown !== null && redirectCountdown > 0 && (
                  <p className="text-xs text-green-700 mt-2">
                    Redirecting to Dashboard in {redirectCountdown} second{redirectCountdown !== 1 ? 's' : ''}...
                  </p>
                )}
              </div>
            )}

            {isScanning && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Scanning in progress... This may take a few minutes.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Select one or more AWS regions to scan</p>
          <p>2. Click "Start Scan" to begin resource discovery</p>
          <p>3. Watch real-time progress as resources are discovered</p>
          <p>4. View discovered resources in the Resources page</p>
          <p className="pt-2 text-xs">
            The scanner uses Claude CLI with MCP to discover EC2 instances, VPCs, S3 buckets, RDS databases, and Lambda functions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
