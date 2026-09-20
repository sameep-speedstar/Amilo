# Partner booking APIs (founding team BD)

Amilo prefers **official partner APIs** (phone-authenticated) when available.
Browser automation is the **fallback**. Flip adapters in
[`packages/booking/src/adapters/stubs.ts`](../packages/booking/src/adapters/stubs.ts)
by setting `enabled: true` and implementing `searchAndFulfill`.

## Target platforms

| Merchant | Vertical | Need | Payment |
|----------|----------|------|---------|
| Zepto | grocery | Phone OTP order / agent API | COD default |
| Blinkit | grocery | Phone OTP order API | COD default |
| BigBasket | grocery | Agent / partner checkout | COD default |
| Instamart | grocery | Partner API | COD default |
| Zomato | dining | Table reservation API | Pay at venue |
| EazyDiner | dining | Reservation partner API | Pay at venue |
| BookMyShow | ticketing | Seat hold + **payment link** return | Prepaid → WA pay link |
| District | ticketing | Same | Prepaid → WA pay link |

## Adapter contract

```ts
searchAndFulfill(intent) →
  needs_otp | needs_selection | ready_confirm | pay_link | placed | blocked | failed
```

- Auth: user phone (WhatsApp E.164)
- Never collect card/UPI PIN on Amilo
- Prepaid: return `pay_link` with merchant checkout URL

## Status

All stubs ship with `enabled: false` until credentials land.
