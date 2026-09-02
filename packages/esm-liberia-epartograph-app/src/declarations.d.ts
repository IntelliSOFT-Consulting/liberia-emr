declare module '*.scss' {
  const classes: { [key: string]: string };
  export default classes;
}

declare namespace fhir {
  type Patient = any;
}
