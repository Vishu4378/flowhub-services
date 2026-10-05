import { Schema } from 'mongoose';

/**
 * Shapes every document for the API: exposes `id` instead of `_id`, drops the
 * version key, and strips `select: false` paths. Those are only excluded from
 * queries by Mongoose, so a freshly created document would otherwise leak them.
 * Registered once on the connection in DatabaseModule.
 */
export function toJsonPlugin(schema: Schema) {
  const hidden: string[] = [];
  schema.eachPath((path, type) => {
    if ((type.options as { select?: boolean }).select === false) {
      hidden.push(path);
    }
  });

  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret._id;
      for (const path of hidden) delete ret[path];
      return ret;
    },
  });
}
