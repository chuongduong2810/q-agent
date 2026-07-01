# TC-001 - Login with Valid Credentials

## Objective

Verify that a registered user can successfully log in using valid credentials.

## Preconditions

* The application is accessible.
* A valid user account exists.
* The user is currently logged out.

## Test Data

| Field    | Value                                       |
| -------- | ------------------------------------------- |
| Username | [test@example.com](mailto:test@example.com) |
| Password | Password123!                                |

## Test Steps

| Step | Action                                     | Expected Result                                   |
| ---- | ------------------------------------------ | ------------------------------------------------- |
| 1    | Navigate to the Login page.                | The Login page is displayed successfully.         |
| 2    | Enter the username `test@example.com`.     | The username is entered correctly.                |
| 3    | Enter the password `Password123!`.         | The password is entered correctly.                |
| 4    | Click the **Login** button.                | The user is redirected to the Dashboard.          |
| 5    | Verify the user information in the header. | The logged-in user's name is displayed correctly. |

## Expected Result

The user successfully logs in and can access the Dashboard without any error messages.

## Priority

High

## Test Type

Functional

## Automation Candidate

Yes

## Postconditions

The user remains logged in.
