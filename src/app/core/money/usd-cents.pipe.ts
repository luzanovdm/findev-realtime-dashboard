import { Pipe, PipeTransform } from '@angular/core';
import type Decimal from 'decimal.js';
import { formatUsdCents } from './format-usd-cents';

@Pipe({
  name: 'usdCents',
})
export class UsdCentsPipe implements PipeTransform {
  transform(value: Decimal | null): string {
    return formatUsdCents(value);
  }
}
