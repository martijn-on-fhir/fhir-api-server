import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TenantConnectionService } from './tenant-connection.service';
import { TENANT_ID_PATTERN, TenantInfo, TenantStatus } from './tenant.interfaces';
import { Tenant } from './tenant.schema';

/**
 * Service for tenant lifecycle management: CRUD, provisioning, suspend/activate.
 * All tenant records are stored in the master database.
 */
@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    @InjectModel(Tenant.name) private readonly tenantModel: Model<Tenant>,
    private readonly connectionService: TenantConnectionService,
  ) {}

  /**
   * Lists all tenants, optionally filtered by status.
   * @param status - Optional status filter.
   */
  async findAll(status?: TenantStatus): Promise<TenantInfo[]> {
    const filter = status ? { status } : {};

    return this.tenantModel.find(filter).sort({ createdAt: -1 }).lean<TenantInfo[]>();
  }

  /**
   * Finds a tenant by ID.
   * @param id - Tenant identifier.
   * @throws NotFoundException if not found.
   */
  async findById(id: string): Promise<TenantInfo> {
    const tenant = await this.tenantModel.findOne({ id }).lean<TenantInfo>();

    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} not found`);
    }

    return tenant;
  }

  /**
   * Registers a new tenant and provisions its database.
   * @param data - Tenant creation data.
   * @throws BadRequestException if ID format is invalid.
   * @throws ConflictException if tenant ID already exists.
   */
  async create(data: { id: string; name: string; contactEmail?: string; config?: any }): Promise<TenantInfo> {
    if (!TENANT_ID_PATTERN.test(data.id)) {
      throw new BadRequestException(`Invalid tenant ID format. Expected hex segments separated by dashes (e.g. 6edb-752-09a51b-4)`);
    }

    const existing = await this.tenantModel.findOne({ id: data.id });

    if (existing) {
      throw new ConflictException(`Tenant ${data.id} already exists`);
    }

    const tenant = await this.tenantModel.create({
      id: data.id,
      name: data.name,
      status: 'active',
      contactEmail: data.contactEmail,
      config: data.config,
    });

    // Provision the tenant database by creating the connection and indexes
    await this.connectionService.getModels(data.id);
    this.logger.log(`Tenant ${data.id} (${data.name}) created and provisioned`);

    return tenant.toObject();
  }

  /**
   * Suspends an active tenant, blocking further FHIR requests.
   * @param id - Tenant identifier.
   */
  async suspend(id: string): Promise<TenantInfo> {
    const tenant = await this.tenantModel.findOneAndUpdate(
      { id, status: 'active' },
      { status: 'suspended' },
      { returnDocument: 'after' },
    ).lean<TenantInfo>();

    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} not found or not active`);
    }

    this.logger.warn(`Tenant ${id} suspended`);

    return tenant;
  }

  /**
   * Reactivates a suspended tenant.
   * @param id - Tenant identifier.
   */
  async activate(id: string): Promise<TenantInfo> {
    const tenant = await this.tenantModel.findOneAndUpdate(
      { id, status: 'suspended' },
      { status: 'active' },
      { returnDocument: 'after' },
    ).lean<TenantInfo>();

    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} not found or not suspended`);
    }

    this.logger.log(`Tenant ${id} reactivated`);

    return tenant;
  }

  /**
   * Decommissions a tenant and drops its database.
   * @param id - Tenant identifier.
   */
  async decommission(id: string): Promise<void> {
    const tenant = await this.tenantModel.findOneAndUpdate(
      { id, status: { $ne: 'decommissioned' } },
      { status: 'decommissioned' },
      { returnDocument: 'after' },
    );

    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} not found or already decommissioned`);
    }

    await this.connectionService.dropTenantDatabase(id);
    this.logger.warn(`Tenant ${id} decommissioned and database dropped`);
  }
}
