import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types, type Connection } from 'mongoose';
import { UsersService } from '../users/users.service.js';
import { Activity } from './entities/activity.schema.js';
import { ListActivityQuery } from './dto/list-activity.query.js';

const WEEKS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the week containing `date`. */
function startOfWeek(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(d.getTime() - day * DAY_MS);
}

export interface RecordActivityInput {
  organizationId: string;
  type: string;
  actorId?: string;
  subject?: { id: string; name: string; kind: string };
  meta?: Record<string, unknown>;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    @InjectConnection() private readonly connection: Connection,
    private readonly usersService: UsersService,
  ) {}

  async record(input: RecordActivityInput): Promise<void> {
    await this.activities.create({
      organizationId: new Types.ObjectId(input.organizationId),
      type: input.type,
      actorId: input.actorId ? new Types.ObjectId(input.actorId) : null,
      subject: input.subject ?? null,
      meta: input.meta ?? {},
    });
  }

  /** Newest first, with actor names resolved. Paginate with `before`. */
  async list(orgId: string, query: ListActivityQuery) {
    const filter: QueryFilter<Activity> = {
      organizationId: new Types.ObjectId(orgId),
    };
    if (query.before) filter.createdAt = { $lt: query.before };
    const entries = await this.activities
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(query.limit ?? 30)
      .exec();
    const actorIds = [
      ...new Set(
        entries.flatMap((e) => (e.actorId ? [e.actorId.toString()] : [])),
      ),
    ];
    const actors = await this.usersService.findByIds(actorIds);
    const names = new Map(actors.map((u) => [u.id as string, u.name]));
    return entries.map((e) =>
      Object.assign(e.toJSON(), {
        actorName: e.actorId
          ? (names.get(e.actorId.toString()) ?? 'Former member')
          : null,
      }),
    );
  }

  async overview(orgId: string) {
    const organizationId = new Types.ObjectId(orgId);
    const since = new Date(
      startOfWeek(new Date()).getTime() - (WEEKS - 1) * 7 * DAY_MS,
    );
    const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
    const Project = this.connection.models.Project;
    const Membership = this.connection.models.Membership;

    const [statusCounts, members, createdByWeek, activityByType] =
      await Promise.all([
        Project
          ? Project.aggregate<{ _id: string; count: number }>([
              { $match: { organizationId } },
              { $group: { _id: '$status', count: { $sum: 1 } } },
            ]).exec()
          : [],
        Membership ? Membership.countDocuments({ organizationId }).exec() : 0,
        this.activities
          .aggregate<{ _id: Date; count: number }>([
            {
              $match: {
                organizationId,
                type: 'project.created',
                createdAt: { $gte: since },
              },
            },
            {
              $group: {
                _id: {
                  $dateTrunc: {
                    date: '$createdAt',
                    unit: 'week',
                    startOfWeek: 'monday',
                  },
                },
                count: { $sum: 1 },
              },
            },
          ])
          .exec(),
        this.activities
          .aggregate<{ _id: string; count: number }>([
            { $match: { organizationId, createdAt: { $gte: thirtyDaysAgo } } },
            { $group: { _id: '$type', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
          .exec(),
      ]);

    // Fill empty weeks with zeros so charts get a continuous series.
    const byWeek = new Map(
      createdByWeek.map((w) => [new Date(w._id).getTime(), w.count]),
    );
    const projectsCreatedByWeek = Array.from({ length: WEEKS }, (_, i) => {
      const weekStart = new Date(since.getTime() + i * 7 * DAY_MS);
      return { weekStart, count: byWeek.get(weekStart.getTime()) ?? 0 };
    });
    const status = Object.fromEntries(
      statusCounts.map((s) => [s._id, s.count]),
    );

    return {
      totals: {
        activeProjects: status.active ?? 0,
        archivedProjects: status.archived ?? 0,
        members,
        eventsLast30Days: activityByType.reduce((sum, a) => sum + a.count, 0),
      },
      projectsCreatedByWeek,
      activityByType: activityByType.map((a) => ({
        type: a._id,
        count: a.count,
      })),
    };
  }
}
