using { clouddna.softdelete.softDeleted } from '@clouddna/cds-plugin-soft-delete';
using { clouddna.support } from '../db/schema';

extend support.Incidents with softDeleted;
