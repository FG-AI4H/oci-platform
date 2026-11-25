# Declaring a model

> English version of a guide written in French first: [declaring-a-model.fr.md](./declaring-a-model.fr.md).

The **model card** describes your model: what it does, for which patients, who reads its output, and what it must not be used for. An evaluation result linked to the card becomes evidence for that model. Without a card, the evidence summary cannot say what the model is for, and lists that as a gap.

You need an account. Any signed-in user may declare a model.

## Where to start

Click **Models** at the top of the page, then **Declare a model**. The same button is on your **Dashboard**, under **My models**. That section also lists the cards you have already declared, whatever their status.

The form has five steps, listed at the side. The **Next** button, followed by the step's name, checks the current step before moving on. **Back** goes back without losing anything. Fields marked **required** must be filled in.

## Step 1: The model

- **Model identifier**: lowercase letters, digits and hyphens, for example _chest-xr-triage_. It becomes the card's address and cannot be changed later.
- **Version**: three numbers separated by dots, for example _1.0.0_.
- **Model class**: the kind of model, for example **Classical ML**.
- **Developer**: the organisation responsible for the model, which need not be you.
- **Developer contact**: an e-mail address or a web page. It is published with the card.
- **How the model works**: a technical summary, with its inputs and outputs.
- **Clinical summary**, optional: two or three sentences for clinicians.

## Step 2: Intended use

This is the most important step. Your answers make up the **intended-use statement**:

- **Clinical task**: what the model does, for example **Screening**, **Triage** or **Diagnosis**;
- **Body system or site**, for example the chest;
- **Target population**: the age, sex and a description of the patients;
- **Intended users**: who reads the model's output;
- **Care settings**: where the model is used, for example **Emergency**;
- **Clinical pathway**: whether a clinician confirms the output before any decision;
- **Foreseeable misuse**: how the model could be misused, for example on patients it was not validated for;
- **Contraindications**: when it must not be used.

**What the intended-use statement is.** It is your claim about the model: _this is what it does, for whom, under which conditions_. Everything else is read against it. An evaluation result shows how the model behaved on one dataset; the statement says whether that result answers the right question. It describes your model, never the test data.

While you answer, the box **Risk tier from your answers so far** updates.

## Step 3: Risk tier

This step shows the tier, from I to IV, with its **Why:** and the three answers it comes from.

| Tier | Meaning                                                   |
| ---- | --------------------------------------------------------- |
| I    | Informs; low impact on care                               |
| II   | Drives clinical action in a non-critical situation        |
| III  | Drives clinical action in a serious or critical situation |
| IV   | Decides alone in a serious or critical situation          |

**Why you do not choose it.** The tier is derived from three answers: the clinical task, the clinical pathway and the care settings. The rule follows the matrix of the IMDRF, the International Medical Device Regulators Forum. It crosses how much the information matters with how serious the clinical situation is:

| Clinical task                                                | Tier                                                |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **Research only**, **Administrative**, **Patient education** | I                                                   |
| **Screening**, **Triage**                                    | II; III if **Emergency** is among the care settings |
| **Clinical decision support**                                | II                                                  |
| **Prognosis**, **Monitoring**                                | II; III if the pathway is **Standalone**            |
| **Diagnosis**, **Treatment planning**                        | III; IV if the pathway is **Standalone**            |
| **Other**                                                    | II, the default; reviewers may ask for details      |

The tier follows from what you claim, not from a choice. The same answers always give the same tier, on the form and on the platform. A reviewer, or an authority, sees why. To change the tier you change the claim: click **Change the intended use**. The model must then really be used the way you describe.

This tier is not your device's regulatory class. That is declared in the next step.

## Step 4: Evidence and limits

Everything here is optional, but each answer helps the reviewer:

- **Training data**: where the data came from and how they were labelled. Visible to reviewers, not on the public page;
- **Training data jurisdictions**: country or region codes;
- **Regulatory status**: the **Regulatory pathway**, the **Approval status** and the certificate number, if your model has one;
- **Known limits and biases** and **Bias mitigation**;
- **Monitoring after deployment**: how performance is followed once the model is in use.

## Step 5: Review and save

Read each part again. An **Edit** link takes you back to that step. Then click **Save as draft**. The card's page opens.

## After saving

The **Status of this card** box says where the card stands:

1. **Draft**: only you and the reviewers can see it. **Edit the card** opens it again.
2. When it is complete, click **Submit for review**. It can no longer be edited. To correct it, click **Return to draft**. The WHO Model Facts label, which sums up the card, is generated at this point.
3. A reviewer checks it, then clicks **Publish**. That cannot be you, even if you are a reviewer or an administrator. The **Published** card is listed in the **Models** catalogue and can no longer be edited.
4. A published card can be withdrawn (**Withdraw**). It stays on the record, marked **Withdrawn**, and takes no new results.

You can link a result to your card from the draft stage on: see [Submitting predictions](./submitting-predictions.md#5-choose-your-model-card). On the Model Facts label, linked results are listed under **Published results** or **Provisional results (not published evidence)**. A result stays provisional there until the version of the evaluation method that produced it is approved.
