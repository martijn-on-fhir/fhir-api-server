import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { Connection } from 'mongoose';
import { CircuitBreakerService } from '../resilience/circuit-breaker.service';

/** Health check endpoints for monitoring and container orchestration. */
@ApiTags('Health')
@Controller('health')
export class HealthController {

  constructor(@InjectConnection() private readonly connection: Connection, @Optional() @Inject(CircuitBreakerService) private readonly cbService?: CircuitBreakerService) {}

  /** Combined health check — returns detailed status of all subsystems. */
  @Get()
  @ApiOperation({ summary: 'Health check', description: 'Returns server health status including database connectivity.' })
  @ApiResponse({ status: 200, description: 'Server is healthy' })
  @ApiResponse({ status: 503, description: 'Server is unhealthy' })
  async check(@Res() res: Response) {

    const dbState = this.connection.readyState;
    const dbOk = dbState === 1;
    const status = dbOk ? 'healthy' : 'unhealthy';
    const httpStatus = dbOk ? 200 : 503;

    const result: any = {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '0.0.1',
      checks: {
        database: { status: dbOk ? 'up' : 'down', type: 'mongodb', readyState: dbState },
        memory: { rss: Math.round(process.memoryUsage().rss / 1024 / 1024), heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), unit: 'MB' },
      },
    };

    if (this.cbService) {
      result.checks.circuitBreakers = this.cbService.getStatuses();
    }

    res.status(httpStatus).json(result);
  }

  /** Liveness probe — returns 200 if the process is running. Use for Kubernetes livenessProbe. */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe', description: 'Returns 200 if the process is alive. Does not check dependencies.' })
  @ApiResponse({ status: 200, description: 'Process is alive' })
  live(@Res() res: Response) {
    res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
  }

  /** Readiness probe — returns 200 only when the server can serve requests (DB connected). Use for Kubernetes readinessProbe. */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe', description: 'Returns 200 if the server is ready to accept traffic (database connected).' })
  @ApiResponse({ status: 200, description: 'Server is ready' })
  @ApiResponse({ status: 503, description: 'Server is not ready' })
  ready(@Res() res: Response) {
    const dbOk = this.connection.readyState === 1;
    const httpStatus = dbOk ? 200 : 503;
    res.status(httpStatus).json({ status: dbOk ? 'ready' : 'not_ready', timestamp: new Date().toISOString(), checks: { database: dbOk ? 'up' : 'down' } });
  }
}
