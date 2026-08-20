namespace clouddna.softdelete;

/**
 * Include this aspect to make an entity soft-deletable:
 *
 *   using { clouddna.softdelete.softDeleted } from '@clouddna/cds-plugin-soft-delete';
 *   extend my.Orders with softDeleted;
 *
 * DELETE requests then mark the row instead of removing it, READ requests hide
 * marked rows, and the bound `restore()` action brings a row back.
 *
 * The `@softDelete` annotation on the aspect is what the runtime looks for; it
 * propagates to every entity including this aspect and on into service
 * projections, so consumers never annotate anything by hand.
 */
aspect softDeleted @(softDelete) {

  /** When the row was soft-deleted. `null` means the row is live. */
  @readonly @UI.Hidden
  deletedAt : Timestamp;

  /** Who soft-deleted the row. */
  @readonly @UI.Hidden
  deletedBy : String(255);

} actions {

  /** Undo a soft delete. */
  action restore();

}
