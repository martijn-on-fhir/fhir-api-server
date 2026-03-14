import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TenantStatus } from './tenant.interfaces';
import { TenantService } from './tenant.service';

/**
 * Admin API for tenant lifecycle management.
 * Provides CRUD operations and status transitions (suspend/activate/decommission).
 */
@ApiTags('Tenant Administration')
@Controller('admin/tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  /** Lists all registered tenants, optionally filtered by status. */
  @Get()
  @ApiOperation({ summary: 'List all tenants' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'suspended', 'decommissioned'] })
  async findAll(@Query('status') status?: TenantStatus) {
    return this.tenantService.findAll(status);
  }

  /** Returns details for a specific tenant. */
  @Get(':id')
  @ApiOperation({ summary: 'Get tenant details' })
  @ApiParam({ name: 'id', description: 'Tenant ID (hex-dash format)' })
  async findById(@Param('id') id: string) {
    return this.tenantService.findById(id);
  }

  /** Registers a new tenant and provisions its database. */
  @Post()
  @ApiOperation({ summary: 'Register a new tenant' })
  async create(@Body() body: { id: string; name: string; contactEmail?: string; config?: any }) {
    return this.tenantService.create(body);
  }

  /** Suspends an active tenant, blocking FHIR requests. */
  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a tenant' })
  @ApiParam({ name: 'id', description: 'Tenant ID' })
  async suspend(@Param('id') id: string) {
    return this.tenantService.suspend(id);
  }

  /** Reactivates a suspended tenant. */
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a suspended tenant' })
  @ApiParam({ name: 'id', description: 'Tenant ID' })
  async activate(@Param('id') id: string) {
    return this.tenantService.activate(id);
  }

  /** Decommissions a tenant and drops its database. */
  @Delete(':id')
  @ApiOperation({ summary: 'Decommission a tenant' })
  @ApiParam({ name: 'id', description: 'Tenant ID' })
  async decommission(@Param('id') id: string) {
    await this.tenantService.decommission(id);

    return { message: `Tenant ${id} decommissioned` };
  }
}
