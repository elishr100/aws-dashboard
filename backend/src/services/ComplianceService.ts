import { ClaudeMCPService } from './ClaudeMCPService.js';
import type {
  ComplianceFramework,
  ComplianceEvaluation,
  ComplianceControl,
  ControlStatus,
  ComplianceFrameworkDefinition,
  ComplianceTrend,
  ComplianceDashboardStats,
} from '../types/compliance.js';

export class ComplianceService {
  private claudeService: ClaudeMCPService;
  private evaluations: Map<string, ComplianceEvaluation> = new Map();
  private frameworks: Map<ComplianceFramework, ComplianceFrameworkDefinition>;

  /**
   * Constructor with dependency injection for ClaudeMCPService
   * This ensures a single shared instance with synchronized credentials
   */
  constructor(claudeService: ClaudeMCPService) {
    this.claudeService = claudeService;
    this.frameworks = new Map();
    this.initializeFrameworks();
    console.log(`[Compliance] Initialized with shared ClaudeMCPService instance`);
  }

  /**
   * Initialize compliance framework definitions
   */
  private initializeFrameworks(): void {
    // CIS AWS Foundations Benchmark
    this.frameworks.set(ComplianceFramework.CIS_AWS, {
      framework: ComplianceFramework.CIS_AWS,
      name: 'CIS AWS Foundations Benchmark',
      description: 'Best practices for securing AWS accounts',
      version: '1.4.0',
      controls: [
        {
          id: 'cis-1.1',
          framework: ComplianceFramework.CIS_AWS,
          controlId: '1.1',
          title: 'Avoid the use of root account',
          description: 'The root account has unrestricted access to all resources',
          category: 'Identity and Access Management',
          severity: 'CRITICAL',
          remediationSteps: [
            'Create IAM users for day-to-day activities',
            'Enable MFA on root account',
            'Lock away root account credentials',
          ],
        },
        {
          id: 'cis-1.2',
          framework: ComplianceFramework.CIS_AWS,
          controlId: '1.2',
          title: 'Ensure MFA is enabled for all IAM users',
          description: 'Multi-factor authentication adds an extra layer of protection',
          category: 'Identity and Access Management',
          severity: 'HIGH',
          remediationSteps: ['Enable virtual or hardware MFA for all users'],
        },
        {
          id: 'cis-2.1',
          framework: ComplianceFramework.CIS_AWS,
          controlId: '2.1',
          title: 'Ensure S3 bucket encryption is enabled',
          description: 'Encryption protects data at rest',
          category: 'Storage',
          severity: 'HIGH',
          remediationSteps: ['Enable default encryption on all S3 buckets'],
        },
        {
          id: 'cis-2.2',
          framework: ComplianceFramework.CIS_AWS,
          controlId: '2.2',
          title: 'Ensure S3 bucket logging is enabled',
          description: 'Access logging provides audit trail',
          category: 'Storage',
          severity: 'MEDIUM',
          remediationSteps: ['Enable server access logging on S3 buckets'],
        },
        {
          id: 'cis-3.1',
          framework: ComplianceFramework.CIS_AWS,
          controlId: '3.1',
          title: 'Ensure VPC flow logging is enabled',
          description: 'Flow logs capture network traffic information',
          category: 'Networking',
          severity: 'MEDIUM',
          remediationSteps: ['Enable VPC Flow Logs for all VPCs'],
        },
      ],
    });

    // NIST 800-53
    this.frameworks.set(ComplianceFramework.NIST_800_53, {
      framework: ComplianceFramework.NIST_800_53,
      name: 'NIST 800-53',
      description: 'Security and Privacy Controls for Information Systems',
      version: 'Rev 5',
      controls: [
        {
          id: 'nist-ac-2',
          framework: ComplianceFramework.NIST_800_53,
          controlId: 'AC-2',
          title: 'Account Management',
          description: 'Organizations must manage information system accounts',
          category: 'Access Control',
          severity: 'HIGH',
          remediationSteps: ['Implement account lifecycle management', 'Regular access reviews'],
        },
        {
          id: 'nist-sc-7',
          framework: ComplianceFramework.NIST_800_53,
          controlId: 'SC-7',
          title: 'Boundary Protection',
          description: 'Monitor and control communications at external boundaries',
          category: 'System and Communications Protection',
          severity: 'HIGH',
          remediationSteps: ['Implement security groups', 'Use NACLs', 'Enable VPC Flow Logs'],
        },
      ],
    });

    // ISO 27001
    this.frameworks.set(ComplianceFramework.ISO_27001, {
      framework: ComplianceFramework.ISO_27001,
      name: 'ISO/IEC 27001',
      description: 'Information Security Management System',
      version: '2013',
      controls: [
        {
          id: 'iso-a.9.2.1',
          framework: ComplianceFramework.ISO_27001,
          controlId: 'A.9.2.1',
          title: 'User Registration and De-registration',
          description: 'Formal user registration and de-registration process',
          category: 'Access Control',
          severity: 'MEDIUM',
          remediationSteps: ['Implement formal user provisioning process'],
        },
        {
          id: 'iso-a.12.3.1',
          framework: ComplianceFramework.ISO_27001,
          controlId: 'A.12.3.1',
          title: 'Information Backup',
          description: 'Backup copies of information, software and system images',
          category: 'Operations Security',
          severity: 'HIGH',
          remediationSteps: ['Enable automated backups', 'Test backup restoration'],
        },
      ],
    });
  }

  /**
   * Evaluate compliance against a framework
   */
  async evaluateCompliance(
    framework: ComplianceFramework,
    profile: string,
    region?: string
  ): Promise<ComplianceEvaluation> {
    console.log(`[Compliance] Evaluating ${framework} for ${profile}`);

    this.claudeService.setProfile(profile);

    const frameworkDef = this.frameworks.get(framework);
    if (!frameworkDef) {
      throw new Error(`Framework ${framework} not found`);
    }

    // Evaluate each control
    const evaluatedControls: ComplianceControl[] = [];
    for (const control of frameworkDef.controls) {
      const status = await this.evaluateControl(control, profile, region);
      evaluatedControls.push({
        ...control,
        status,
        evaluatedAt: new Date().toISOString(),
      });
    }

    // Calculate scores
    const compliant = evaluatedControls.filter((c) => c.status === 'COMPLIANT').length;
    const nonCompliant = evaluatedControls.filter((c) => c.status === 'NON_COMPLIANT').length;
    const partial = evaluatedControls.filter((c) => c.status === 'PARTIAL').length;
    const notApplicable = evaluatedControls.filter((c) => c.status === 'NOT_APPLICABLE').length;
    const notEvaluated = evaluatedControls.filter((c) => c.status === 'NOT_EVALUATED').length;

    const applicableControls = evaluatedControls.length - notApplicable - notEvaluated;
    const score = applicableControls > 0
      ? Math.round((compliant / applicableControls) * 100)
      : 0;

    const evaluation: ComplianceEvaluation = {
      id: `eval-${Date.now()}-${framework}`,
      framework,
      profile,
      region,
      evaluatedAt: new Date().toISOString(),
      score,
      totalControls: evaluatedControls.length,
      compliant,
      nonCompliant,
      partial,
      notApplicable,
      notEvaluated,
      controls: evaluatedControls,
      summary: `Compliance score: ${score}%. ${compliant} compliant, ${nonCompliant} non-compliant controls.`,
    };

    this.evaluations.set(evaluation.id, evaluation);
    console.log(`[Compliance] Evaluation complete: ${score}% compliant`);

    return evaluation;
  }

  /**
   * Evaluate a single control
   */
  private async evaluateControl(
    control: Omit<ComplianceControl, 'status' | 'evaluatedAt' | 'evidence'>,
    profile: string,
    region?: string
  ): Promise<ControlStatus> {
    try {
      // Map control to security check
      const prompt = `Evaluate AWS compliance control "${control.title}" for profile ${profile}.
Control ID: ${control.controlId}
Description: ${control.description}
Category: ${control.category}

Using AWS MCP tools, check if this control is compliant.
Return JSON: {"status": "COMPLIANT" | "NON_COMPLIANT" | "PARTIAL", "evidence": "Brief explanation"}`;

      const response = await this.claudeService.query(prompt);
      const data = this.extractJSON(response.content);

      if (data?.status) {
        return data.status as ControlStatus;
      }

      // Default fallback based on control category
      return this.defaultControlEvaluation(control);
    } catch (error: any) {
      console.error(`[Compliance] Failed to evaluate control ${control.controlId}:`, error.message);
      return 'NOT_EVALUATED';
    }
  }

  /**
   * Default control evaluation (fallback)
   */
  private defaultControlEvaluation(
    control: Omit<ComplianceControl, 'status' | 'evaluatedAt' | 'evidence'>
  ): ControlStatus {
    // Simple heuristics based on control title
    const title = control.title.toLowerCase();

    if (title.includes('mfa') || title.includes('root account')) {
      return 'NON_COMPLIANT'; // Assume not compliant for critical controls
    }

    if (title.includes('encryption') || title.includes('logging')) {
      return 'PARTIAL'; // Assume partial compliance
    }

    return 'NOT_EVALUATED';
  }

  /**
   * Get evaluation by ID
   */
  getEvaluation(evaluationId: string): ComplianceEvaluation | undefined {
    return this.evaluations.get(evaluationId);
  }

  /**
   * Get all evaluations
   */
  getEvaluations(filters?: {
    framework?: ComplianceFramework;
    profile?: string;
  }): ComplianceEvaluation[] {
    let evaluations = Array.from(this.evaluations.values());

    if (filters?.framework) {
      evaluations = evaluations.filter((e) => e.framework === filters.framework);
    }
    if (filters?.profile) {
      evaluations = evaluations.filter((e) => e.profile === filters.profile);
    }

    return evaluations.sort(
      (a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime()
    );
  }

  /**
   * Get compliance trends
   */
  getComplianceTrends(
    framework: ComplianceFramework,
    profile: string,
    days: number = 30
  ): ComplianceTrend[] {
    const evaluations = this.getEvaluations({ framework, profile });

    // Group by date
    const trendMap = new Map<string, ComplianceTrend>();

    evaluations.forEach((evaluation) => {
      const date = evaluation.evaluatedAt.split('T')[0];
      if (!trendMap.has(date)) {
        trendMap.set(date, {
          date,
          framework,
          score: evaluation.score,
          compliant: evaluation.compliant,
          nonCompliant: evaluation.nonCompliant,
        });
      }
    });

    return Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get dashboard statistics
   */
  getDashboardStats(profile?: string): ComplianceDashboardStats {
    const evaluations = profile
      ? this.getEvaluations({ profile })
      : Array.from(this.evaluations.values());

    if (evaluations.length === 0) {
      return {
        overallScore: 0,
        byFramework: [],
        criticalViolations: 0,
        openViolations: 0,
        recentEvaluations: [],
        trends: [],
      };
    }

    // Calculate overall score
    const totalScore = evaluations.reduce((sum, e) => sum + e.score, 0);
    const overallScore = Math.round(totalScore / evaluations.length);

    // Group by framework
    const frameworkMap = new Map<ComplianceFramework, ComplianceEvaluation[]>();
    evaluations.forEach((evaluation) => {
      if (!frameworkMap.has(evaluation.framework)) {
        frameworkMap.set(evaluation.framework, []);
      }
      frameworkMap.get(evaluation.framework)!.push(evaluation);
    });

    const byFramework = Array.from(frameworkMap.entries()).map(([framework, evals]) => {
      const latestEval = evals[0]; // Already sorted by date
      return {
        framework,
        score: latestEval.score,
        compliant: latestEval.compliant,
        nonCompliant: latestEval.nonCompliant,
      };
    });

    // Count critical violations
    const criticalViolations = evaluations.reduce((sum, evaluation) => {
      return (
        sum +
        evaluation.controls.filter((c) => c.severity === 'CRITICAL' && c.status === 'NON_COMPLIANT').length
      );
    }, 0);

    const openViolations = evaluations.reduce((sum, evaluation) => {
      return sum + evaluation.controls.filter((c) => c.status === 'NON_COMPLIANT').length;
    }, 0);

    return {
      overallScore,
      byFramework,
      criticalViolations,
      openViolations,
      recentEvaluations: evaluations.slice(0, 5),
      trends: [],
    };
  }

  /**
   * Get framework definition
   */
  getFramework(framework: ComplianceFramework): ComplianceFrameworkDefinition | undefined {
    return this.frameworks.get(framework);
  }

  /**
   * Get all frameworks
   */
  getAllFrameworks(): ComplianceFrameworkDefinition[] {
    return Array.from(this.frameworks.values());
  }

  /**
   * Extract JSON from Claude response
   */
  private extractJSON(text: string): any {
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        return JSON.parse(objectMatch[0]);
      }

      return null;
    } catch (error) {
      console.error('[Compliance] Failed to parse JSON:', error);
      return null;
    }
  }
}
