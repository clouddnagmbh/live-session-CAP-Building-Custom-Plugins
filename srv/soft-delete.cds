using { clouddna.softdelete.softDeleted } from '@clouddna/cds-plugin-soft-delete';

// Every entity listed here marks rows on DELETE instead of removing them,
// hides them from READs, and gets a bound restore() action.
// extend clouddna.support.Customers with softDeleted;
extend clouddna.support.Incidents with softDeleted;
