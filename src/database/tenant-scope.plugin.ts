import { Aggregate, Query, Schema } from 'mongoose';

const FILTERED_QUERIES: readonly string[] = [
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
];

export class TenantScopeError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model}.${operation}() must filter by organizationId (tenant isolation)`,
    );
    this.name = 'TenantScopeError';
  }
}

interface TenantScopeOptions {
  skipTenantScope?: boolean;
}

/**
 * Rejects any query or aggregation on a tenant-owned collection that does not
 * filter by organizationId. Pass `{ skipTenantScope: true }` as a query option
 * for deliberate cross-tenant access (migrations, admin jobs).
 */
export function tenantScopePlugin(schema: Schema) {
  if (!schema.path('organizationId')) {
    throw new Error('tenantScopePlugin requires an organizationId path');
  }

  schema.pre(FILTERED_QUERIES as any, function (this: Query<unknown, unknown>) {
    const options = this.getOptions() as TenantScopeOptions;
    if (options.skipTenantScope) return;
    if (this.getFilter().organizationId == null) {
      throw new TenantScopeError(
        this.model.modelName,
        (this as { op?: string }).op ?? 'query',
      );
    }
  });

  schema.pre('aggregate', function (this: Aggregate<unknown>) {
    const options = this.options as TenantScopeOptions;
    if (options.skipTenantScope) return;
    const [first] = this.pipeline();
    const match = first && '$match' in first ? first.$match : undefined;
    if (match?.organizationId == null) {
      throw new TenantScopeError(
        this.model().modelName,
        'aggregate (first stage must $match organizationId)',
      );
    }
  });
}
