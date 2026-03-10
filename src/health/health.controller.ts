import { Controller, Get, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { Connection } from 'mongoose';

/** Health check endpoint for monitoring and container orchestration. */
@ApiTags('Health')
@Controller('health')
export class HealthController {

  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  @ApiOperation({ summary: 'Health check', description: 'Returns server health status including database connectivity.' })
  @ApiResponse({ status: 200, description: 'Server is healthy' })
  @ApiResponse({ status: 503, description: 'Server is unhealthy' })
  async check(@Res() res: Response) {

    const dbState = this.connection.readyState;
    const dbOk = dbState === 1; // 1 = connected
    const status = dbOk ? 'healthy' : 'unhealthy';
    const httpStatus = dbOk ? 200 : 503;

    const result = {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '0.0.1',
      checks: {
        database: {
          status: dbOk ? 'up' : 'down',
          type: 'mongodb',
          readyState: dbState,
        },
        memory: {
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          unit: 'MB',
        },
      },
    };

    res.status(httpStatus).json(result);
  }
}
