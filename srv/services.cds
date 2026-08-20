using { clouddna.support } from '../db/schema';

service SupportService {

  entity Incidents as projection on support.Incidents;
  entity Customers as projection on support.Customers;

}
