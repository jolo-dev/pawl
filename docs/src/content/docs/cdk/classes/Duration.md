---
editUrl: false
next: false
prev: false
title: "Duration"
---

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:9

Represents a length of time.

The amount can be specified either as a literal value (e.g: `10`) which
cannot be negative, or as an unresolved number token.

When the amount is passed as a token, unit conversion is not possible.

## Methods

### formatTokenToNumber()

> **formatTokenToNumber**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:139

Returns stringified number of duration

#### Returns

`string`

***

### isUnresolved()

> **isUnresolved**(): `boolean`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:131

Checks if duration is a token or a resolvable object

#### Returns

`boolean`

***

### minus()

> **minus**(`rhs`): `Duration`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:70

Substract two Durations together

#### Parameters

##### rhs

`Duration`

#### Returns

`Duration`

***

### plus()

> **plus**(`rhs`): `Duration`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:66

Add two Durations together

#### Parameters

##### rhs

`Duration`

#### Returns

`Duration`

***

### toDays()

> **toDays**(`opts?`): `number`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:100

Return the total number of days in this Duration

#### Parameters

##### opts?

`TimeConversionOptions`

#### Returns

`number`

the value of this `Duration` expressed in Days.

***

### toHours()

> **toHours**(`opts?`): `number`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:94

Return the total number of hours in this Duration

#### Parameters

##### opts?

`TimeConversionOptions`

#### Returns

`number`

the value of this `Duration` expressed in Hours.

***

### toHumanString()

> **toHumanString**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:111

Turn this duration into a human-readable string

#### Returns

`string`

***

### toIsoString()

> **toIsoString**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:107

Return an ISO 8601 representation of this period

#### Returns

`string`

a string starting with 'P' describing the period

#### See

https://www.iso.org/standard/70907.html

***

### toMilliseconds()

> **toMilliseconds**(`opts?`): `number`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:76

Return the total number of milliseconds in this Duration

#### Parameters

##### opts?

`TimeConversionOptions`

#### Returns

`number`

the value of this `Duration` expressed in Milliseconds.

***

### toMinutes()

> **toMinutes**(`opts?`): `number`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:88

Return the total number of minutes in this Duration

#### Parameters

##### opts?

`TimeConversionOptions`

#### Returns

`number`

the value of this `Duration` expressed in Minutes.

***

### toSeconds()

> **toSeconds**(`opts?`): `number`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:82

Return the total number of seconds in this Duration

#### Parameters

##### opts?

`TimeConversionOptions`

#### Returns

`number`

the value of this `Duration` expressed in Seconds.

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:118

Returns a string representation of this `Duration`

This is never the right function to use when you want to use the `Duration`
object in a template. Use `toSeconds()`, `toMinutes()`, `toDays()`, etc. instead.

#### Returns

`string`

***

### unitLabel()

> **unitLabel**(): `string`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:135

Returns unit of the duration

#### Returns

`string`

***

### days()

> `static` **days**(`amount`): `Duration`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:44

Create a Duration representing an amount of days

#### Parameters

##### amount

`number`

the amount of Days the `Duration` will represent.

#### Returns

`Duration`

a new `Duration` representing `amount` Days.

***

### hours()

> `static` **hours**(`amount`): `Duration`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:37

Create a Duration representing an amount of hours

#### Parameters

##### amount

`number`

the amount of Hours the `Duration` will represent.

#### Returns

`Duration`

a new `Duration` representing `amount` Hours.

***

### millis()

> `static` **millis**(`amount`): `Duration`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:16

Create a Duration representing an amount of milliseconds

#### Parameters

##### amount

`number`

the amount of Milliseconds the `Duration` will represent.

#### Returns

`Duration`

a new `Duration` representing `amount` ms.

***

### minutes()

> `static` **minutes**(`amount`): `Duration`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:30

Create a Duration representing an amount of minutes

#### Parameters

##### amount

`number`

the amount of Minutes the `Duration` will represent.

#### Returns

`Duration`

a new `Duration` representing `amount` Minutes.

***

### parse()

> `static` **parse**(`duration`): `Duration`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:59

Parse a period formatted according to the ISO 8601 standard

Days are the largest ISO duration supported, i.e.,
weeks, months, and years are not supported.

#### Parameters

##### duration

`string`

an ISO-formatted duration to be parsed.

#### Returns

`Duration`

the parsed `Duration`.

#### Example

```ts
// This represents 1 day, 2 hours, 3 minutes, 4 seconds, and 567 milliseconds.
'P1DT2H3M4.567S'
```

#### See

https://www.iso.org/standard/70907.html

***

### seconds()

> `static` **seconds**(`amount`): `Duration`

Defined in: node\_modules/aws-cdk-lib/core/lib/duration.d.ts:23

Create a Duration representing an amount of seconds

#### Parameters

##### amount

`number`

the amount of Seconds the `Duration` will represent.

#### Returns

`Duration`

a new `Duration` representing `amount` Seconds.
