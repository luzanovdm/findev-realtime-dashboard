export function requiredElement<T extends Element>(
  root: ParentNode,
  selector: string,
  expected: { new (): T },
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof expected)) {
    throw new Error(`Expected ${selector} to be a ${expected.name}`);
  }
  return element;
}
