import {
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import {
  DomainEvent,
  type DomainEventName,
  type ProjectEvent,
} from '../../common/events/domain-events.js';
import { BillingService } from '../billing/billing.service.js';
import { Project, ProjectDocument } from './entities/project.schema.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { ListProjectsQuery } from './dto/list-projects.query.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every method takes the tenant id first; the schema plugin enforces it. */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project.name) private readonly projects: Model<Project>,
    private readonly billingService: BillingService,
    private readonly events: EventEmitter2,
  ) {}

  list(orgId: string, query: ListProjectsQuery): Promise<ProjectDocument[]> {
    const filter: QueryFilter<Project> = {
      organizationId: new Types.ObjectId(orgId),
    };
    if (query.status) filter.status = query.status;
    if (query.search?.trim()) {
      filter.name = { $regex: escapeRegex(query.search.trim()), $options: 'i' };
    }
    return this.projects.find(filter).sort({ updatedAt: -1 }).exec();
  }

  async create(orgId: string, userId: string, dto: CreateProjectDto) {
    await this.billingService.assertWithinLimit(orgId, 'projects');
    const project = await this.projects.create({
      name: dto.name,
      description: dto.description,
      organizationId: new Types.ObjectId(orgId),
      createdBy: new Types.ObjectId(userId),
    });
    this.emit(DomainEvent.ProjectCreated, project, userId);
    return project;
  }

  async get(orgId: string, id: string): Promise<ProjectDocument> {
    const project = await this.projects
      .findOne({ _id: id, organizationId: new Types.ObjectId(orgId) })
      .exec();
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateProjectDto,
    userId: string,
  ): Promise<ProjectDocument> {
    const before = await this.get(orgId, id);
    const project = await this.projects
      .findOneAndUpdate(
        { _id: id, organizationId: new Types.ObjectId(orgId) },
        dto,
        { returnDocument: 'after', runValidators: true },
      )
      .exec();
    if (!project) throw new NotFoundException('Project not found');

    if (dto.status && dto.status !== before.status) {
      this.emit(
        dto.status === 'archived'
          ? DomainEvent.ProjectArchived
          : DomainEvent.ProjectRestored,
        project,
        userId,
      );
    } else if (dto.name !== undefined || dto.description !== undefined) {
      this.emit(DomainEvent.ProjectUpdated, project, userId);
    }
    return project;
  }

  async remove(orgId: string, id: string, userId: string): Promise<void> {
    const project = await this.projects
      .findOneAndDelete({ _id: id, organizationId: new Types.ObjectId(orgId) })
      .exec();
    if (!project) throw new NotFoundException('Project not found');
    this.emit(DomainEvent.ProjectDeleted, project, userId);
  }

  /**
   * TODO(you) — Phase 3, Day 14: generate (or rotate) this project's API key.
   *
   * The plumbing is ready: the route (POST .../projects/:id/api-key, admins
   * only), the schema fields, and the dashboard card that calls it.
   * What's left is the part interviewers ask about:
   *   1. Generate a random key with a recognisable prefix (see
   *      common/utils/tokens.ts for the random + SHA-256 helpers).
   *   2. Store only its hash + a display prefix; overwrite the old one (rotation).
   *   3. Return the full key exactly once — it can never be shown again.
   * Then Day 9: a guard that reads `x-org-api-key`, hashes it, finds the
   * project (skipTenantScope: you don't know the org yet!) and attaches its
   * organizationId to the request.
   */
  async rotateApiKey(
    orgId: string,
    id: string,
  ): Promise<{ apiKey: string; project: ProjectDocument }> {
    await this.get(orgId, id); // 404s for other orgs' projects
    throw new NotImplementedException(
      'Project API keys are not implemented yet',
    );
  }

  private emit(
    name: DomainEventName,
    project: ProjectDocument,
    actorId: string,
  ) {
    this.events.emit(name, {
      organizationId: project.organizationId.toString(),
      actorId,
      projectId: project.id as string,
      projectName: project.name,
    } satisfies ProjectEvent);
  }
}
