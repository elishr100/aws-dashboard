export interface CostDashboardSummary {
  totalCurrentMonth: number;
  projectedMonthEnd: number;
  topExpensiveResources: Array<{
    resourceId: string;
    resourceType: string;
    resourceName?: string;
    cost: number;
  }>;
  currency: string;
  notes?: string[]; // Optional notes (e.g., Bedrock billing info, payer account details)
}
