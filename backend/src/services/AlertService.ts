import { EventEmitter } from 'events';
import type { SecurityAlert, SecurityFinding, FindingSeverity } from '../types/security.js';
import { persistentCache } from './PersistentCacheService.js';

export class AlertService extends EventEmitter {
  private alerts: Map<string, SecurityAlert> = new Map();
  private alertThresholds: Map<FindingSeverity, boolean> = new Map([
    ['CRITICAL', true],
    ['HIGH', true],
    ['MEDIUM', false],
    ['LOW', false],
    ['INFO', false],
  ]);

  constructor() {
    super();
  }

  /**
   * Load alerts from persistent cache for a profile
   * When clearExisting is false, merges with existing alerts instead of replacing
   */
  async loadAlertsFromCache(profile: string, clearExisting: boolean = false): Promise<number> {
    try {
      const { PersistentCacheService } = await import('./PersistentCacheService.js');

      const cachedAlerts = persistentCache.get<SecurityAlert[]>(
        PersistentCacheService.alertsKey(profile)
      );

      if (cachedAlerts && Array.isArray(cachedAlerts)) {
        if (clearExisting) {
          this.alerts.clear();
        }
        cachedAlerts.forEach(alert => {
          this.alerts.set(alert.id, alert);
        });
        console.log(`[AlertService] Loaded ${cachedAlerts.length} alerts from cache for ${profile}`);
        return cachedAlerts.length;
      }
      return 0;
    } catch (error) {
      console.error('[AlertService] Failed to load alerts from cache:', error);
      return 0;
    }
  }

  /**
   * Persist alerts to disk for a profile
   */
  private async persistAlerts(profile: string): Promise<void> {
    try {
      const { PersistentCacheService } = await import('./PersistentCacheService.js');

      const alertsArray = Array.from(this.alerts.values())
        .filter(alert => alert.profile === profile);

      await persistentCache.set(
        PersistentCacheService.alertsKey(profile),
        alertsArray
      );
      console.log(`[AlertService] Persisted ${alertsArray.length} alerts for ${profile}`);
    } catch (error) {
      console.error('[AlertService] Failed to persist alerts:', error);
    }
  }

  /**
   * Create alert from security finding
   */
  createAlertFromFinding(finding: SecurityFinding): SecurityAlert {
    const alert: SecurityAlert = {
      id: `alert-${Date.now()}-${finding.id}`,
      findingId: finding.id,
      severity: finding.severity,
      title: finding.title,
      message: `${finding.description}\n\nRecommendation: ${finding.recommendation}`,
      resourceId: finding.resourceId,
      profile: finding.profile,
      region: finding.region,
      acknowledged: false,
      createdAt: new Date().toISOString(),
    };

    this.alerts.set(alert.id, alert);

    // Persist alerts to disk
    this.persistAlerts(finding.profile).catch(err => {
      console.error('[AlertService] Failed to persist alert:', err);
    });

    // Emit alert event for real-time notifications
    if (this.shouldAlert(finding.severity)) {
      this.emit('alert', alert);
      console.log(`[AlertService] Alert created: ${alert.title} (${alert.severity})`);
    }

    return alert;
  }

  /**
   * Create alerts from multiple findings
   */
  createAlertsFromFindings(findings: SecurityFinding[]): SecurityAlert[] {
    return findings.map((finding) => this.createAlertFromFinding(finding));
  }

  /**
   * Create alerts from all critical and high severity findings
   * This is called automatically after an audit completes
   */
  async createAlertsFromCriticalAndHighFindings(findings: SecurityFinding[]): Promise<SecurityAlert[]> {
    const criticalAndHighFindings = findings.filter(
      f => f.severity === 'CRITICAL' || f.severity === 'HIGH'
    );

    console.log(
      `[AlertService] Creating alerts for ${criticalAndHighFindings.length} critical/high findings`
    );

    // Get profiles and regions from findings
    const profileRegions = new Set(criticalAndHighFindings.map(f => `${f.profile}:${f.region}`));

    // Clear old unacknowledged alerts for the same profile/region combinations
    // This ensures alerts match the current audit results
    const alertsToKeep: SecurityAlert[] = [];
    for (const [alertId, alert] of this.alerts.entries()) {
      const alertKey = `${alert.profile}:${alert.region}`;

      // Keep acknowledged alerts and alerts from different profile/region combinations
      if (alert.acknowledged || !profileRegions.has(alertKey)) {
        alertsToKeep.push(alert);
      } else {
        console.log(`[AlertService] Clearing old unacknowledged alert: ${alert.title}`);
      }
    }

    // Rebuild alerts map with only alerts we want to keep
    this.alerts.clear();
    alertsToKeep.forEach(alert => this.alerts.set(alert.id, alert));

    // Create new alerts from current findings
    const alerts = criticalAndHighFindings.map((finding) => this.createAlertFromFinding(finding));

    // Persist all alerts for each profile
    const profiles = new Set(criticalAndHighFindings.map(f => f.profile));
    for (const profile of profiles) {
      await this.persistAlerts(profile);
    }

    console.log(`[AlertService] Created ${alerts.length} alerts from critical/high findings (cleared old unacknowledged alerts)`);
    return alerts;
  }

  /**
   * Get all alerts with optional filters
   */
  getAlerts(filters?: {
    profile?: string;
    region?: string;
    severity?: FindingSeverity;
    acknowledged?: boolean;
  }): SecurityAlert[] {
    let alerts = Array.from(this.alerts.values());

    if (filters?.profile) {
      alerts = alerts.filter((a) => a.profile === filters.profile);
    }
    if (filters?.region) {
      alerts = alerts.filter((a) => a.region === filters.region);
    }
    if (filters?.severity) {
      alerts = alerts.filter((a) => a.severity === filters.severity);
    }
    if (filters?.acknowledged !== undefined) {
      alerts = alerts.filter((a) => a.acknowledged === filters.acknowledged);
    }

    // Sort by severity and creation date
    return alerts.sort((a, b) => {
      const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  /**
   * Get alert by ID
   */
  getAlert(alertId: string): SecurityAlert | undefined {
    return this.alerts.get(alertId);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string, acknowledgedBy?: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date().toISOString();
    alert.acknowledgedBy = acknowledgedBy;

    this.alerts.set(alertId, alert);

    // Persist changes
    this.persistAlerts(alert.profile).catch(err => {
      console.error('[AlertService] Failed to persist alert acknowledgment:', err);
    });

    this.emit('alert-acknowledged', alert);
    console.log(`[AlertService] Alert acknowledged: ${alertId}`);

    return true;
  }

  /**
   * Acknowledge multiple alerts
   */
  acknowledgeAlerts(alertIds: string[], acknowledgedBy?: string): number {
    let acknowledged = 0;
    for (const id of alertIds) {
      if (this.acknowledgeAlert(id, acknowledgedBy)) {
        acknowledged++;
      }
    }
    return acknowledged;
  }

  /**
   * Delete an alert
   */
  deleteAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    const profile = alert.profile;
    const deleted = this.alerts.delete(alertId);

    if (deleted) {
      // Persist changes
      this.persistAlerts(profile).catch(err => {
        console.error('[AlertService] Failed to persist alert deletion:', err);
      });
    }

    return deleted;
  }

  /**
   * Get alert statistics
   */
  getAlertStats(): {
    total: number;
    acknowledged: number;
    unacknowledged: number;
    bySeverity: Record<string, number>;
    byProfile: Record<string, number>;
  } {
    const allAlerts = Array.from(this.alerts.values());

    const bySeverity: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    };

    const byProfile: Record<string, number> = {};

    allAlerts.forEach((alert) => {
      bySeverity[alert.severity]++;
      byProfile[alert.profile] = (byProfile[alert.profile] || 0) + 1;
    });

    return {
      total: allAlerts.length,
      acknowledged: allAlerts.filter((a) => a.acknowledged).length,
      unacknowledged: allAlerts.filter((a) => !a.acknowledged).length,
      bySeverity,
      byProfile,
    };
  }

  /**
   * Configure alert thresholds
   */
  setAlertThreshold(severity: FindingSeverity, enabled: boolean): void {
    this.alertThresholds.set(severity, enabled);
  }

  /**
   * Check if should create alert for severity
   */
  private shouldAlert(severity: FindingSeverity): boolean {
    return this.alertThresholds.get(severity) || false;
  }

  /**
   * Clear old alerts (older than specified days)
   */
  clearOldAlerts(days: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffTime = cutoffDate.getTime();

    let deleted = 0;
    for (const [id, alert] of this.alerts.entries()) {
      if (new Date(alert.createdAt).getTime() < cutoffTime) {
        this.alerts.delete(id);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[AlertService] Cleared ${deleted} old alerts`);
    }

    return deleted;
  }
}
