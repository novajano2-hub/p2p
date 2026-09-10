/*
  @abay/contracts

  Every shape that crosses the API boundary, written by hand, field by field.
  This package never imports Prisma or anything from the database layer: that
  rule is what keeps a password hash, an internal risk score, or a custody
  provider reference from reaching a browser because someone reused a model
  type. The browser and the API both depend on this package; neither depends
  on the other.
*/

export * from "./errors";
export * from "./health";
export * from "./kyc";
export * from "./auth";
