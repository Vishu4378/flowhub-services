import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BillingModule } from '../billing/billing.module.js';
import { Project, ProjectSchema } from './entities/project.schema.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Project.name, schema: ProjectSchema }]),
    BillingModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
