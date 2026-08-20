namespace clouddna.support;

using { cuid, managed } from '@sap/cds/common';

/**
 * Customers raising support incidents.
 * Deliberately *not* soft-deletable — so the plugin's opt-in nature is provable.
 */
entity Customers : cuid {
  name      : String(111);
  email     : String(111);
  country   : String(20);
  incidents : Association to many Incidents on incidents.customer = $self;
}

/**
 * Support incidents. Compliance says these must never physically vanish.
 */
entity Incidents : cuid, managed {
  title    : String(111);
  urgency  : String(10) default 'medium';
  status   : String(10) default 'open';
  customer : Association to Customers;
}
