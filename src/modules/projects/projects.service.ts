import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
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

  create(orgId: string, userId: string, dto: CreateProjectDto) {
    return this.projects.create({
      name: dto.name,
      description: dto.description,
      organizationId: new Types.ObjectId(orgId),
      createdBy: new Types.ObjectId(userId),
    });
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
  ): Promise<ProjectDocument> {
    const project = await this.projects
      .findOneAndUpdate(
        { _id: id, organizationId: new Types.ObjectId(orgId) },
        dto,
        { returnDocument: 'after', runValidators: true },
      )
      .exec();
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async remove(orgId: string, id: string): Promise<void> {
    const { deletedCount } = await this.projects
      .deleteOne({ _id: id, organizationId: new Types.ObjectId(orgId) })
      .exec();
    if (!deletedCount) throw new NotFoundException('Project not found');
  }
}
