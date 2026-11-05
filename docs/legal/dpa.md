# ItemTraxx Data Processing Addendum

**Effective date:** [[EFFECTIVE_DATE]]  
**Provider:** [[ENTITY_DESCRIPTION]] ("ItemTraxx," "we," "us")  
**Contact:** privacy@itemtraxx.com · [[MAILING_ADDRESS]]

This Data Processing Addendum ("DPA") supplements the applicable order form, subscription agreement, or other written agreement between ItemTraxx and the school, district, business, or other organization identified in that agreement ("Customer"), together with the ItemTraxx [Terms of Service](terms-of-service.md) (the "Agreement"). It applies to every Customer.

"**Customer Data**" has the meaning given in the Terms of Service. "**Student Data**" has the meaning given in Part B of the [Student Privacy Notice and FERPA / SOPIPA Compliance Addendum](student-privacy-notice.md) (the "Student Data Addendum"). Student Data is a kind of Customer Data.

## 1. Roles and Instructions

Customer controls the Customer Data submitted to ItemTraxx. ItemTraxx processes Customer Data only to provide, secure, support, and maintain the contracted service, and according to Customer's documented lawful instructions. Customer gives those instructions through its use of the service's features and through the Agreement. ItemTraxx will tell Customer if it believes an instruction violates applicable law.

## 2. Student Data

If Customer submits Student Data, the Student Data Addendum applies in addition to this DPA. The Student Data Addendum governs the purposes for which Student Data may be used, the use limits, parent and student access, and the retention and deletion of Student Data. This DPA does not repeat those terms.

## 3. Educational Customers (FERPA and COPPA)

The terms on ItemTraxx's school-official status under FERPA, COPPA, SOPIPA, and California Education Code section 49073.1 are in the Student Data Addendum (Part B, Sections 1 to 3).

## 4. Confidentiality and Security

ItemTraxx maintains application safeguards implemented in the current service, including role and workspace-scoped access controls, authentication and privileged-session protections, request filtering, audit logging, dependency and code scanning, emergency protective controls, and incident alerting. ItemTraxx limits access to Customer Data to personnel who need it for support, security, and operations and who are bound by confidentiality obligations. A summary of the measures appears in Annex A.

## 5. Subprocessors

1. **Authorization.** Customer authorizes ItemTraxx to use the subprocessors listed in the [Subprocessor Directory](subprocessor-directory.md), which is the single current list of the providers that process Customer Data and of what each one does.
2. **Obligations.** Each subprocessor is bound by a written agreement that requires protections no less protective than this DPA, and ItemTraxx remains responsible for each subprocessor's handling of Customer Data.
3. **Notice and objection.** At least **30 days before** ItemTraxx adds or replaces a subprocessor that will process Customer Data, it will email Customer's workspace administrators and update the directory. Customer may object in writing to privacy@itemtraxx.com within that period on reasonable data-protection grounds. If the objection cannot be resolved, Customer may terminate the affected service and receive a refund of prepaid fees for the remaining term. If ItemTraxx must replace a subprocessor immediately to protect security or continuity, it will notify Customer as soon as practicable and the same objection right applies. The directory's change process (its Section 3) applies.
4. **Student Data.** For subprocessors that handle Student Data, Section 4 of the Student Data Addendum also applies. The email provider and the incident-alerting provider do not receive Student Data: ItemTraxx builds its transactional emails and incident alerts without borrower fields.

## 6. Requests and Cooperation

ItemTraxx will reasonably assist Customer with verified requests to access, correct, export, restrict, or delete Customer Data. Requests from students, parents, or guardians concerning school-controlled records will be referred to or coordinated with Customer.

## 7. Security Incidents

ItemTraxx maintains monitoring, escalation, and incident-notification tooling. If ItemTraxx confirms a security incident that compromised Customer Data, it will notify Customer's designated contact without undue delay and:

- for **Student Data**, in any event within **72 hours of confirmation**, as set out in Section 9 of the Student Data Addendum; and
- for **other Customer Data**, within [[OTHER_DATA_INCIDENT_NOTICE]] of confirmation.

Notification will include a description of the incident, the approximate data affected (to the extent known), and the recommended measures to be taken by affected users (to the extent known). The executed agreement may specify additional notice contacts, required information, or a shorter notification deadline. These notices are in addition to the duty in California Civil Code section 1798.82, under which a business that maintains data it does not own must notify the owner immediately after discovery. If processing is subject to GDPR or similar law, any regulator or supervisory-authority notification obligation remains independently binding and is not limited by this customer-notification timeline. ItemTraxx's notification obligation does not extend to incidents affecting only non-Customer infrastructure or publicly available information.

## 8. Retention, Return, and Deletion

1. **During the term.** Authorized administrators can export supported operational datasets. Records can be archived and restored through the service's administration features, and ItemTraxx will help with a complete export on request.
2. **On request.** On Customer's written request from a workspace administrator, ItemTraxx will delete specific Customer Data or all Customer Data within 30 days, subject to Section 8.4.
3. **At termination.** When the Agreement ends or Customer archives its workspace, ItemTraxx keeps the workspace for a **30-day recovery period**, during which Customer may ask for a restore or a complete export. After that period an automated process permanently deletes the workspace data, staff accounts, support requests and attachments, email delivery logs, and error reports, and ItemTraxx will issue a written deletion certificate on request. For Student Data, Section 7 of the Student Data Addendum also applies. <!-- E-DEPENDENCY: this describes the intended policy. It depends on applying the workspace-purge migration and deploying the job-worker function in production. Status checked 2026-11-04: not yet in production. The production database has not applied the migrations 20261104120000, 20261104130000, and 20261104140000, and the deployed job-worker predates them. Confirm before publication. -->
4. **Exceptions.** Backups are overwritten on a rolling schedule within [[BACKUP_RETENTION_DAYS]] days. Pseudonymous security audit records that contain no names or emails (identifiers are random unique codes) may be kept. ItemTraxx may also keep data as the law requires, and will tell Customer and limit its use where it does.

## 9. Audit Information

On reasonable written request, no more than once a year unless there has been an incident, ItemTraxx will provide available information about its security and privacy controls needed for Customer's vendor review, subject to confidentiality and security limits. Section 11 of the Student Data Addendum applies to Student Data.

## 10. International Processing

ItemTraxx operates from the United States and processes Customer Data in the locations described in Annex A. If Customer authorizes processing subject to GDPR, UK GDPR, or international transfer restrictions, the parties must execute the applicable controller-processor terms and transfer mechanism before that processing begins.

## 11. Order of Precedence

If documents conflict on a data protection matter, the following order applies, with the first item controlling:

1. the executed agreement or Order Form;
2. a signed Student Data Privacy Agreement or California school rider, if one has been executed with Customer;
3. the Student Data Addendum (Part B);
4. this DPA;
5. the Terms of Service; and
6. the Privacy Policy and Part A of the Student Privacy Notice.

<!-- VERIFY (counsel): no California school rider or Student Data Privacy Agreement template exists in docs/legal. The reference is conditional on one being signed. -->

## 12. CCPA/CPRA Service Provider Terms

To the extent the California Consumer Privacy Act (CCPA) or California Privacy Rights Act (CPRA) applies to Customer Data, ItemTraxx acts as a Service Provider (as defined under CCPA/CPRA) and not as a Third Party or Business with respect to that data. ItemTraxx will not sell or share Customer Data, use it for cross-context behavioral advertising, retain, use, or disclose it outside the direct business relationship with Customer or for any purpose other than the business purpose stated in this DPA and the Agreement, or disclose it except as permitted under CCPA/CPRA for service providers. ItemTraxx will cooperate with Customer in responding to verifiable consumer requests to the extent ItemTraxx holds the relevant data and the request is directed to ItemTraxx in accordance with this DPA.

## Annex A: Description of Processing

| Item | Description |
|---|---|
| **Subject matter and nature** | Hosting and operating inventory and checkout software for Customer: storing, retrieving, displaying, and exporting Customer Data, and securing and supporting the service. |
| **Purposes** | Providing, securing, supporting, and maintaining the service for Customer, as set out in Section 1. For Student Data, the purposes in the Student Data Addendum. |
| **Duration** | The term of the Agreement plus the recovery period and deletion process in Section 8. |
| **Data subjects** | Customer's staff and other Authorized Users; borrowers recorded by Customer (which may include students); people who contact ItemTraxx on Customer's behalf. |
| **Categories of data** | Borrower username, borrower ID, access setting, and checkout history; item records and notes; workspace settings, organization name and logo; audit entries; staff and user account data (name, email, role, authentication data, session and device records); support requests and uploaded image attachments; error reports. ItemTraxx has no fields for a borrower's email address, phone number, date of birth, grade, photo, or address, and Customer must not enter sensitive categories (see Terms of Service, Section 5). |
| **Sensitive data** | None intended. |
| **Locations** | Database and file storage in [[DATABASE_REGION]]; backups created in [[BACKUP_LOCATION]] and stored in encrypted form with GitHub in the United States; network delivery through a global edge network. Locations for each subprocessor are in the Subprocessor Directory. |
| **Retention** | As in Section 8 of this DPA and Section 6 of the Privacy Policy. |
| **Security measures** | Encryption in transit and, by our hosting providers, at rest; workspace isolation enforced in the database; role-based access; strong authentication options (passwords of at least 12 characters, passkeys, two-factor authentication, and single sign-on); session management and revocation; encrypted offline storage with 24-hour pack expiry; rate limiting and bot protection; logging and audit trails of administrative and security-relevant actions; continuous automated security testing and periodic third-party assessments; incident response with automated alerting; backups; and personnel access limited to those who need it and bound by confidentiality. |

## Annex B: Subprocessors

The current list of subprocessors is the [Subprocessor Directory](subprocessor-directory.md). Changes are handled under Section 5 of this DPA.
