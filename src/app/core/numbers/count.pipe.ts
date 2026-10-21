import { Pipe, PipeTransform } from '@angular/core';
import { formatCount } from './format-count';

@Pipe({ name: 'count' })
export class CountPipe implements PipeTransform {
  transform(value: bigint): string {
    return formatCount(value);
  }
}
