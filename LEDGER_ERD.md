# 후원 원장(Ledger) — DB ERD

FIFO 충전 소진 + 복식부기(Journal) 기반의 후원 결제 원장 스키마입니다.
GitHub에서 아래 다이어그램이 자동 렌더링됩니다.

## ERD

```mermaid
erDiagram
    PAYMENT_METHOD ||--o{ FEE_POLICY : "02_FEE_POLICY"
    PAYMENT_METHOD ||--o{ CHARGE_TRANSACTION : "03_CHARGE_TRANSACTION"
    PAYMENT_METHOD ||--o{ FUNDING_LOT : "04_FUNDING_LOT"
    PAYMENT_METHOD ||--o{ DONATION_ALLOCATION : "10_DONATION_ALLOCATION"

    DONOR ||--|| DONOR_WALLET : "05_DONOR_WALLET"
    DONOR ||--o{ CHARGE_TRANSACTION : "03_CHARGE_TRANSACTION"
    DONOR ||--o{ FUNDING_LOT : "04_FUNDING_LOT"
    DONOR ||--o{ DONATION : "09_DONATION"

    RECEIVER ||--|| RECEIVER_WALLET : "06_RECEIVER_WALLET"
    RECEIVER ||--o{ DONATION : "09_DONATION"

    CHARGE_TRANSACTION ||--o{ FUNDING_LOT : "04_FUNDING_LOT"
    FEE_POLICY ||--o{ CHARGE_TRANSACTION : "03_CHARGE_TRANSACTION(스냅샷)"

    DONATION ||--o{ DONATION_ALLOCATION : "10_DONATION_ALLOCATION"
    DONATION ||--o{ DONATION_FEE_ALLOCATION : "11_DONATION_FEE_ALLOCATION"
    FUNDING_LOT ||--o{ DONATION_ALLOCATION : "FIFO 차감"
    FUNDING_LOT ||--o{ DONATION_FEE_ALLOCATION : "수수료 차감"

    DONATION_ALLOCATION ||--o{ DONATION_FEE_ALLOCATION : "배분 수수료"
    DONATION_ALLOCATION ||--o{ DONATION_ALLOCATION : "FK (역분개)"
    DONATION_FEE_ALLOCATION ||--o{ DONATION_FEE_ALLOCATION : "FK (역분개)"

    JOURNAL ||--o{ JOURNAL_LINE : "13_JOURNAL_LINE"
    JOURNAL ||--o{ JOURNAL : "FK (역분개)"
    ACCOUNT ||--o{ JOURNAL_LINE : "13_JOURNAL_LINE"
    ACCOUNT ||--o{ ACCOUNT : "FK (상위계정)"

    DONOR {
        bigint donor_id PK
        string user_id UQ
        string nickname
        string status
        timestamp created_at
    }

    RECEIVER {
        bigint receiver_id PK
        string user_id UQ
        string nickname
        string status
        timestamp created_at
    }

    DONOR_WALLET {
        bigint wallet_id PK
        bigint donor_id FK,UQ
        decimal balance
        bigint version
        timestamp updated_at
    }

    RECEIVER_WALLET {
        bigint wallet_id PK
        bigint receiver_id FK,UQ
        decimal balance
        bigint version
        timestamp updated_at
    }

    PAYMENT_METHOD {
        bigint payment_method_id PK
        string method_code UQ
        string method_name
        string method_type
        string status
        timestamp created_at
    }

    FEE_POLICY {
        bigint fee_policy_id PK
        bigint payment_method_id FK
        string policy_name
        string fee_type
        string fee_rate_type
        decimal rate
        decimal min_fee
        decimal max_fee
        timestamp effective_from
        timestamp effective_to
        string status
        timestamp created_at
    }

    CHARGE_TRANSACTION {
        bigint charge_id PK
        bigint donor_id FK
        bigint payment_method_id FK
        bigint policy_snapshot_id FK
        decimal requested_amount
        decimal fee_rate_snapshot
        decimal fee_amount
        decimal net_amount
        string status
        timestamp approved_at
        timestamp created_at
    }

    FUNDING_LOT {
        bigint funding_lot_id PK
        bigint charge_id FK
        bigint donor_id FK
        bigint payment_method_id FK
        decimal origin_amount
        decimal remaining_amount
        timestamp funded_at
        string status
        timestamp created_at
    }

    DONATION {
        bigint donation_id PK
        bigint donor_id FK
        bigint receiver_id FK
        decimal amount
        decimal fee_total
        string fee_type
        string status
        timestamp requested_at
        timestamp accepted_at
        timestamp completed_at
        timestamp canceled_at
        string idempotency_key UQ
        timestamp created_at
    }

    DONATION_ALLOCATION {
        bigint allocation_id PK
        bigint donation_id FK
        bigint funding_lot_id FK
        bigint payment_method_id FK
        decimal allocated_amount
        bigint original_allocation_id FK
        string allocation_type
        timestamp created_at
    }

    DONATION_FEE_ALLOCATION {
        bigint fee_allocation_id PK
        bigint donation_id FK
        bigint allocation_id FK
        bigint funding_lot_id FK
        string fee_type
        decimal fee_rate
        decimal fee_base_amount
        decimal fee_amount
        bigint original_fee_allocation_id FK
        timestamp created_at
    }

    JOURNAL {
        bigint journal_id PK
        string reference_type_code
        bigint reference_id
        string transaction_type
        bigint original_journal_id FK
        string status
        timestamp posted_at
        timestamp created_at
    }

    JOURNAL_LINE {
        bigint journal_line_id PK
        bigint journal_id FK
        int line_no
        bigint account_id FK
        string entry_type
        decimal amount
        bigint funding_lot_id FK
        bigint donation_id FK
        bigint fee_allocation_id FK
        string description
        timestamp created_at
    }

    ACCOUNT {
        bigint account_id PK
        string account_code UQ
        string account_name
        string account_type
        bigint parent_account_id FK
        string status
        timestamp created_at
    }
```
