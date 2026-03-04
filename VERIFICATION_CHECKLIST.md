# Security Audit Fix - Verification Checklist

## Quick Start

```bash
# Terminal 1 - Start Backend
cd ~/ssm-config/aws-dashboard/backend
npm run dev

# Terminal 2 - Start Frontend
cd ~/ssm-config/aws-dashboard/frontend
npm run dev

# Terminal 3 - Watch Backend Logs
cd ~/ssm-config/aws-dashboard
tail -f backend.log
```

---

## ✅ Verification Steps

### 1. Start the Dashboard
- [ ] Backend starts without errors on http://localhost:3001
- [ ] Frontend starts without errors on http://localhost:5173
- [ ] Can access frontend in browser

### 2. Navigate to Security Dashboard
- [ ] Click "Security" in sidebar
- [ ] Security Dashboard page loads
- [ ] Shows security score card (likely 0% or 100% initially)

### 3. Run Security Audit
- [ ] Check at least one region (e.g., us-west-2)
- [ ] Click "Start Security Audit" button
- [ ] Button changes to "Running Audit..." with spinner
- [ ] Progress bar appears showing "Phase 1/3: Checking infrastructure security..."

### 4. Monitor Backend Logs (Terminal 3)
**CRITICAL: These lines MUST appear in backend.log:**

```
[Audit] ========================================
[Audit] PHASE 1: Infrastructure Security Checks
[Audit] Profile: dev-ah
[Audit] Regions: us-west-2
[Audit] ========================================
[Audit] Starting checks for region: us-west-2
[Audit] Checking EC2 EBS encryption in us-west-2...
[Audit] Executing: aws ec2 describe-volumes --region us-west-2 --filters Name=encrypted,Values=false --output json --profile dev-ah
```

**Expected patterns:**
- [ ] `[Audit] Checking...` messages appear for each check
- [ ] `[Audit] Executing: aws...` shows real AWS CLI commands
- [ ] `[Audit] Found unencrypted volume: vol-xxxxx → HIGH` (if any exist)
- [ ] `[Audit] Found VPC without flow logs → MEDIUM` (if any exist)
- [ ] `[Audit] Checking S3 bucket: <name>` for multiple buckets
- [ ] `[Audit] Phase 1 complete - X findings discovered`
- [ ] `[Audit] PHASE 2: IAM Security Analysis`
- [ ] `[Audit] Analyzing IAM roles...`
- [ ] `[Audit] Found X IAM roles to analyze`
- [ ] `[Audit] PHASE 3: Resource Policies & Monitoring`
- [ ] `[Audit] Audit job-id completed - found X findings with score Y%`

**Anti-patterns (should NOT see):**
- [ ] ❌ `No cached resources found, skipping` (old broken behavior)
- [ ] ❌ Audit completes instantly (< 30 seconds)
- [ ] ❌ No AWS CLI commands in logs
- [ ] ❌ Security score = 100% with no findings

### 5. Frontend Progress Display
**During audit execution:**
- [ ] Progress bar moves from 0% → 100%
- [ ] Phase indicator updates: "Phase 1/3" → "Phase 2/3" → "Phase 3/3"
- [ ] Message updates with details: "Phase 1/3: Checked infrastructure in us-west-2... (12 findings)"
- [ ] Findings count increases in real-time
- [ ] Individual findings appear in "Findings by Severity" section as discovered

### 6. Completion
**After audit completes (2-5 minutes):**
- [ ] Success toast appears: "Security Audit Completed"
- [ ] Toast shows: "Found X findings. Security Score: Y%"
- [ ] **Toast does NOT auto-dismiss** (stays until you click X)
- [ ] Security score updates to reflect real findings
- [ ] "Critical" and "High Priority" cards show actual counts (not 0)
- [ ] "Total Findings" card shows actual count (not 0)

### 7. Expected Results for dev-ah Profile
Based on requirements, you should see approximately:
- [ ] **4 HIGH findings**: Unencrypted EBS volumes
- [ ] **2 MEDIUM findings**: VPCs without Flow Logs
- [ ] **50+ S3 findings**: Public access, encryption, versioning, logging issues (26 buckets)
- [ ] **20+ IAM findings**: Role permissions, MFA, access key rotation (151 roles)
- [ ] **CloudTrail/GuardDuty findings**: Monitoring not enabled
- [ ] **Total findings**: 70-100+
- [ ] **Security score**: 30-60% (significantly below 100%)

### 8. Persistence Check
- [ ] Refresh the page (F5)
- [ ] Security score persists (same value)
- [ ] Findings still visible in "Findings by Severity" section
- [ ] GET request to `/api/security/findings?profile=dev-ah` returns findings

### 9. Error Handling
**Test error resilience:**
- [ ] Start audit in region with no resources (should continue, not crash)
- [ ] Backend log shows errors but continues: "Error checking X in region: ..."
- [ ] Audit completes despite individual check failures
- [ ] Error toast does NOT auto-dismiss if audit fails

---

## 🚨 RED FLAGS (If you see these, something is wrong)

1. **Instant Results**
   - Audit completes in < 30 seconds
   - 0 findings discovered
   - Security score = 100%
   - **Fix**: Check if AWS CLI is working, check profile credentials

2. **No AWS CLI Commands in Logs**
   - Backend log shows "No cached resources found, skipping"
   - No `[Audit] Executing: aws...` lines
   - **Fix**: You may still be running old code, check git status

3. **Toast Auto-Dismisses**
   - Success/error messages disappear after 5 seconds
   - **Fix**: Check ToastContext.tsx has `duration: 0`

4. **Frontend Shows 0% Score**
   - After audit completes, score stays at 0%
   - **Fix**: Check cache keys in backend are correct

5. **Findings Don't Persist**
   - Refresh page → findings disappear
   - **Fix**: Check cache service is saving findings

---

## 📊 Expected Timing

| Phase | Duration | Key Indicators |
|-------|----------|----------------|
| Phase 1 | 1-2 min | EC2, VPC, S3 (parallel), Security Groups, RDS |
| Phase 2 | 1-3 min | IAM roles (151), IAM users, batched processing |
| Phase 3 | 1-2 min | CloudTrail, GuardDuty, KMS, SQS, SNS |
| **TOTAL** | **2-5 min** | **70-100+ findings for dev-ah** |

---

## 🐛 Troubleshooting

### Backend won't start
```bash
cd backend
npm run build
# Check for TypeScript errors in security.ts specifically
```

### No AWS CLI output in logs
```bash
# Test AWS CLI manually
aws ec2 describe-volumes --region us-west-2 --profile dev-ah

# Check credentials
aws sts get-caller-identity --profile dev-ah
```

### Frontend not showing progress
```bash
# Check browser console for errors
# Check network tab - SSE connection to /api/security/audit/{jobId}/stream
```

### Findings not persisting
```bash
# Check cache service
curl http://localhost:3001/api/security/findings?profile=dev-ah

# Should return JSON array of findings, not empty array
```

---

## ✅ Success Criteria

**The fix is working correctly if:**

1. ✅ Audit takes **2-5 minutes** (not instant)
2. ✅ Backend log shows **real AWS CLI commands** being executed
3. ✅ **70-100+ findings** discovered for dev-ah profile
4. ✅ Security score **30-60%** (not 100%)
5. ✅ Findings include **specific resource IDs** (vol-xxxx, vpc-xxxx, etc.)
6. ✅ Toast messages **stay visible** until clicked
7. ✅ Findings **persist** after page refresh
8. ✅ Progress updates in **real-time** as findings are discovered

---

## 📝 Notes

- **First run may be slower** (3-5 minutes) due to AWS API warmup
- **Subsequent runs** should be faster (2-3 minutes)
- **S3 checks run in parallel** so 26 buckets complete quickly
- **IAM analysis is slowest** due to 151 roles with rate limiting protection
- **Error messages in logs are OK** as long as audit continues
- **Not all checks will find issues** - depends on actual AWS config

---

## 📞 If Issues Persist

1. Check `backend.log` for errors
2. Check `SECURITY_AUDIT_FIX_SUMMARY.md` for detailed implementation
3. Verify `security.ts` matches the new implementation
4. Check git diff to see if changes were applied:
   ```bash
   cd backend/src/routes
   git diff security.ts
   ```
