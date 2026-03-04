import { ClaudeMCPService } from './ClaudeMCPService.js';
import { ChatOrchestrator } from './ChatOrchestrator.js';
import { CostAnalysisService } from './CostAnalysisService.js';
import { SecurityAuditService } from './SecurityAuditService.js';
import { ComplianceService } from './ComplianceService.js';
import { OrganizationService } from './OrganizationService.js';
import { AlertService } from './AlertService.js';
import { ResourceDiscoveryAgent } from '../agents/ResourceDiscoveryAgent.js';
import { chatConnections } from '../chatState.js';

/**
 * Service Factory - Manages singleton instances of services
 *
 * This factory ensures:
 * 1. Single shared ClaudeMCPService instance per profile
 * 2. All services (ChatOrchestrator, CostAnalysisService) share the same credentials
 * 3. Credential caching is synchronized across all operations
 * 4. No credential refresh loops due to multiple instances
 */
export class ServiceFactory {
  // Singleton instances per profile
  private static claudeServices = new Map<string, ClaudeMCPService>();
  private static chatOrchestrators = new Map<string, ChatOrchestrator>();
  private static costServices = new Map<string, CostAnalysisService>();
  private static securityServices = new Map<string, SecurityAuditService>();
  private static complianceServices = new Map<string, ComplianceService>();
  private static organizationServices = new Map<string, OrganizationService>();
  private static resourceDiscoveryAgents = new Map<string, ResourceDiscoveryAgent>();
  // Global singleton for AlertService (not profile-specific)
  private static alertService: AlertService;

  /**
   * Get or create shared ClaudeMCPService for a profile
   * This ensures a single credential cache per profile
   */
  static getClaudeMCPService(profile: string, region: string = 'us-west-2'): ClaudeMCPService {
    const key = `${profile}:${region}`;

    let service = this.claudeServices.get(key);
    if (!service) {
      console.log(`[ServiceFactory] Creating new ClaudeMCPService for ${key}`);
      service = new ClaudeMCPService(profile, region);
      this.claudeServices.set(key, service);
    } else {
      console.log(`[ServiceFactory] Reusing existing ClaudeMCPService for ${key}`);
    }

    return service;
  }

  /**
   * Get or create ChatOrchestrator with shared ClaudeMCPService and chatConnections
   */
  static getChatOrchestrator(profile: string, region: string = 'us-west-2'): ChatOrchestrator {
    const key = `${profile}:${region}`;

    let orchestrator = this.chatOrchestrators.get(key);
    if (!orchestrator) {
      console.log(`[ServiceFactory] Creating new ChatOrchestrator for ${key}`);
      const claudeService = this.getClaudeMCPService(profile, region);
      orchestrator = new ChatOrchestrator(claudeService, chatConnections);
      this.chatOrchestrators.set(key, orchestrator);
    } else {
      console.log(`[ServiceFactory] Reusing existing ChatOrchestrator for ${key}`);
    }

    return orchestrator;
  }

  /**
   * Get or create CostAnalysisService with shared ClaudeMCPService
   */
  static getCostAnalysisService(profile: string, region: string = 'us-west-2'): CostAnalysisService {
    const key = `${profile}:${region}`;

    let service = this.costServices.get(key);
    if (!service) {
      console.log(`[ServiceFactory] Creating new CostAnalysisService for ${key}`);
      const claudeService = this.getClaudeMCPService(profile, region);
      service = new CostAnalysisService(claudeService);
      this.costServices.set(key, service);
    } else {
      console.log(`[ServiceFactory] Reusing existing CostAnalysisService for ${key}`);
    }

    return service;
  }

  /**
   * Get or create SecurityAuditService with shared ClaudeMCPService
   */
  static getSecurityAuditService(profile: string, region: string = 'us-west-2'): SecurityAuditService {
    const key = `${profile}:${region}`;

    let service = this.securityServices.get(key);
    if (!service) {
      console.log(`[ServiceFactory] Creating new SecurityAuditService for ${key}`);
      const claudeService = this.getClaudeMCPService(profile, region);
      service = new SecurityAuditService(claudeService);
      this.securityServices.set(key, service);
    } else {
      console.log(`[ServiceFactory] Reusing existing SecurityAuditService for ${key}`);
    }

    return service;
  }

  /**
   * Get or create ComplianceService with shared ClaudeMCPService
   */
  static getComplianceService(profile: string, region: string = 'us-west-2'): ComplianceService {
    const key = `${profile}:${region}`;

    let service = this.complianceServices.get(key);
    if (!service) {
      console.log(`[ServiceFactory] Creating new ComplianceService for ${key}`);
      const claudeService = this.getClaudeMCPService(profile, region);
      service = new ComplianceService(claudeService);
      this.complianceServices.set(key, service);
    } else {
      console.log(`[ServiceFactory] Reusing existing ComplianceService for ${key}`);
    }

    return service;
  }

  /**
   * Get or create OrganizationService with shared ClaudeMCPService
   */
  static getOrganizationService(profile: string, region: string = 'us-west-2'): OrganizationService {
    const key = `${profile}:${region}`;

    let service = this.organizationServices.get(key);
    if (!service) {
      console.log(`[ServiceFactory] Creating new OrganizationService for ${key}`);
      const claudeService = this.getClaudeMCPService(profile, region);
      service = new OrganizationService(claudeService);
      this.organizationServices.set(key, service);
    } else {
      console.log(`[ServiceFactory] Reusing existing OrganizationService for ${key}`);
    }

    return service;
  }

  /**
   * Get or create ResourceDiscoveryAgent with shared ClaudeMCPService
   */
  static getResourceDiscoveryAgent(profile: string, region: string): ResourceDiscoveryAgent {
    const key = `${profile}:${region}`;

    let agent = this.resourceDiscoveryAgents.get(key);
    if (!agent) {
      console.log(`[ServiceFactory] Creating new ResourceDiscoveryAgent for ${key}`);
      const claudeService = this.getClaudeMCPService(profile, region);
      agent = new ResourceDiscoveryAgent(claudeService);
      this.resourceDiscoveryAgents.set(key, agent);
    } else {
      console.log(`[ServiceFactory] Reusing existing ResourceDiscoveryAgent for ${key}`);
    }

    return agent;
  }

  /**
   * Get or create shared AlertService (global singleton)
   * AlertService is not profile-specific, it stores alerts from all profiles
   */
  static getAlertService(): AlertService {
    if (!this.alertService) {
      console.log(`[ServiceFactory] Creating new AlertService singleton`);
      this.alertService = new AlertService();
    } else {
      console.log(`[ServiceFactory] Reusing existing AlertService singleton`);
    }

    return this.alertService;
  }

  /**
   * Clear all cached services for a profile (useful for session refresh)
   */
  static clearProfile(profile: string): void {
    console.log(`[ServiceFactory] Clearing all services for profile: ${profile}`);

    const keysToDelete: string[] = [];

    for (const key of this.claudeServices.keys()) {
      if (key.startsWith(`${profile}:`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.claudeServices.delete(key);
      this.chatOrchestrators.delete(key);
      this.costServices.delete(key);
      this.securityServices.delete(key);
      this.complianceServices.delete(key);
      this.organizationServices.delete(key);
      this.resourceDiscoveryAgents.delete(key);
    }

    console.log(`[ServiceFactory] Cleared ${keysToDelete.length} profile instances`);
  }

  /**
   * Cleanup all services (call on shutdown)
   */
  static cleanup(): void {
    console.log(`[ServiceFactory] Cleaning up all services`);

    // Cleanup chat orchestrators
    for (const orchestrator of this.chatOrchestrators.values()) {
      orchestrator.cleanup();
    }

    this.claudeServices.clear();
    this.chatOrchestrators.clear();
    this.costServices.clear();
    this.securityServices.clear();
    this.complianceServices.clear();
    this.organizationServices.clear();
    this.resourceDiscoveryAgents.clear();
    this.alertService = undefined as any;
  }

  /**
   * Get service statistics
   */
  static getStats(): {
    claudeServices: number;
    chatOrchestrators: number;
    costServices: number;
    securityServices: number;
    complianceServices: number;
    organizationServices: number;
    resourceDiscoveryAgents: number;
    alertService: boolean;
  } {
    return {
      claudeServices: this.claudeServices.size,
      chatOrchestrators: this.chatOrchestrators.size,
      costServices: this.costServices.size,
      securityServices: this.securityServices.size,
      complianceServices: this.complianceServices.size,
      organizationServices: this.organizationServices.size,
      resourceDiscoveryAgents: this.resourceDiscoveryAgents.size,
      alertService: !!this.alertService,
    };
  }
}
