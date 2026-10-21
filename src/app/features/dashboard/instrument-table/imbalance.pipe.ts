import { Pipe, PipeTransform } from '@angular/core';
import type Decimal from 'decimal.js';
import { formatImbalance } from './format-imbalance';

@Pipe({
  name: 'imbalance',
})
export class ImbalancePipe implements PipeTransform {
  transform(value: Decimal | null): string {
    return formatImbalance(value);
  }
}
