export interface Widget {
  value: string;
}

export class DefaultWidget implements Widget {
  constructor(public value: string) {}
}

export function makeWidget(value: string): Widget {
  return new DefaultWidget(value);
}
