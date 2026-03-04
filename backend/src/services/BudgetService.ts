import { EventEmitter } from 'events';
import type { Budget, BudgetAlert } from '../types/cost.js';

export class BudgetService extends EventEmitter {
  private budgets: Map<string, Budget> = new Map();
  private alerts: Map<string, BudgetAlert> = new Map();

  constructor() {
    super();
  }

  /**
   * Create a new budget
   */
  createBudget(budget: Omit<Budget, 'id' | 'currentSpend' | 'percentageUsed' | 'status' | 'createdAt' | 'updatedAt'>): Budget {
    const newBudget: Budget = {
      ...budget,
      id: `budget-${Date.now()}`,
      currentSpend: 0,
      percentageUsed: 0,
      status: 'OK',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.budgets.set(newBudget.id, newBudget);
    console.log(`[BudgetService] Created budget: ${newBudget.name} ($${newBudget.amount})`);

    return newBudget;
  }

  /**
   * Update a budget
   */
  updateBudget(budgetId: string, updates: Partial<Budget>): Budget | null {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      return null;
    }

    const updatedBudget: Budget = {
      ...budget,
      ...updates,
      id: budgetId, // Ensure ID doesn't change
      updatedAt: new Date().toISOString(),
    };

    this.budgets.set(budgetId, updatedBudget);
    console.log(`[BudgetService] Updated budget: ${updatedBudget.name}`);

    return updatedBudget;
  }

  /**
   * Delete a budget
   */
  deleteBudget(budgetId: string): boolean {
    const deleted = this.budgets.delete(budgetId);
    if (deleted) {
      // Also delete related alerts
      Array.from(this.alerts.values())
        .filter((alert) => alert.budgetId === budgetId)
        .forEach((alert) => this.alerts.delete(alert.id));

      console.log(`[BudgetService] Deleted budget: ${budgetId}`);
    }
    return deleted;
  }

  /**
   * Get a budget by ID
   */
  getBudget(budgetId: string): Budget | undefined {
    return this.budgets.get(budgetId);
  }

  /**
   * Get all budgets with optional filters
   */
  getBudgets(filters?: { profile?: string; status?: Budget['status'] }): Budget[] {
    let budgets = Array.from(this.budgets.values());

    if (filters?.profile) {
      budgets = budgets.filter((b) => b.profile === filters.profile);
    }
    if (filters?.status) {
      budgets = budgets.filter((b) => b.status === filters.status);
    }

    return budgets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Update budget spend and check thresholds
   */
  updateBudgetSpend(budgetId: string, currentSpend: number): void {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      return;
    }

    budget.currentSpend = currentSpend;
    budget.percentageUsed = (currentSpend / budget.amount) * 100;

    // Determine status
    if (budget.percentageUsed >= 100) {
      budget.status = 'EXCEEDED';
    } else if (budget.percentageUsed >= 80) {
      budget.status = 'WARNING';
    } else {
      budget.status = 'OK';
    }

    budget.updatedAt = new Date().toISOString();
    this.budgets.set(budgetId, budget);

    // Check alert thresholds
    budget.alertThresholds.forEach((threshold) => {
      if (threshold.enabled && budget.percentageUsed >= threshold.percentage) {
        this.createBudgetAlert(budget, threshold.percentage);
      }
    });
  }

  /**
   * Create a budget alert
   */
  private createBudgetAlert(budget: Budget, threshold: number): void {
    // Check if alert already exists for this threshold
    const existingAlert = Array.from(this.alerts.values()).find(
      (alert) => alert.budgetId === budget.id && alert.threshold === threshold && !alert.acknowledged
    );

    if (existingAlert) {
      return; // Don't create duplicate alerts
    }

    const severity =
      budget.percentageUsed >= 100
        ? 'CRITICAL'
        : budget.percentageUsed >= 80
        ? 'WARNING'
        : 'INFO';

    const alert: BudgetAlert = {
      id: `alert-${Date.now()}-${budget.id}`,
      budgetId: budget.id,
      budgetName: budget.name,
      threshold,
      currentSpend: budget.currentSpend,
      budgetAmount: budget.amount,
      percentageUsed: budget.percentageUsed,
      severity,
      message: `Budget "${budget.name}" has reached ${budget.percentageUsed.toFixed(1)}% of allocated amount ($${budget.currentSpend.toFixed(2)} of $${budget.amount})`,
      triggeredAt: new Date().toISOString(),
      acknowledged: false,
    };

    this.alerts.set(alert.id, alert);
    this.emit('budget-alert', alert);

    console.log(`[BudgetService] Budget alert created: ${alert.message}`);
  }

  /**
   * Get budget alerts
   */
  getBudgetAlerts(filters?: { budgetId?: string; acknowledged?: boolean }): BudgetAlert[] {
    let alerts = Array.from(this.alerts.values());

    if (filters?.budgetId) {
      alerts = alerts.filter((a) => a.budgetId === filters.budgetId);
    }
    if (filters?.acknowledged !== undefined) {
      alerts = alerts.filter((a) => a.acknowledged === filters.acknowledged);
    }

    return alerts.sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime());
  }

  /**
   * Acknowledge a budget alert
   */
  acknowledgeBudgetAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.acknowledged = true;
    this.alerts.set(alertId, alert);

    console.log(`[BudgetService] Budget alert acknowledged: ${alertId}`);
    return true;
  }

  /**
   * Get budget statistics
   */
  getBudgetStats(): {
    total: number;
    exceeded: number;
    warning: number;
    ok: number;
    totalBudgeted: number;
    totalSpent: number;
    averageUtilization: number;
  } {
    const budgets = Array.from(this.budgets.values());

    const stats = {
      total: budgets.length,
      exceeded: budgets.filter((b) => b.status === 'EXCEEDED').length,
      warning: budgets.filter((b) => b.status === 'WARNING').length,
      ok: budgets.filter((b) => b.status === 'OK').length,
      totalBudgeted: budgets.reduce((sum, b) => sum + b.amount, 0),
      totalSpent: budgets.reduce((sum, b) => sum + b.currentSpend, 0),
      averageUtilization: 0,
    };

    if (stats.totalBudgeted > 0) {
      stats.averageUtilization = (stats.totalSpent / stats.totalBudgeted) * 100;
    }

    return stats;
  }

  /**
   * Check all budgets and update their spend
   * This should be called periodically with actual cost data
   */
  async checkAllBudgets(costData: { profile: string; amount: number }[]): Promise<void> {
    console.log('[BudgetService] Checking all budgets against current spend');

    for (const budget of this.budgets.values()) {
      if (budget.profile) {
        const profileCost = costData.find((c) => c.profile === budget.profile);
        if (profileCost) {
          this.updateBudgetSpend(budget.id, profileCost.amount);
        }
      }
    }
  }

  /**
   * Get budgets that are close to exceeding (>= 80%)
   */
  getAtRiskBudgets(): Budget[] {
    return Array.from(this.budgets.values())
      .filter((b) => b.percentageUsed >= 80)
      .sort((a, b) => b.percentageUsed - a.percentageUsed);
  }
}
