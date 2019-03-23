import * as React from 'react'
import { AppState } from './appstate.js'
import AnimatorReactComponent from './animatorReactComponent.jsx'

export default class FeedbackFrame extends AnimatorReactComponent {
  constructor (props) {
    super(props)
    this.state = {
      show: false,
      topAnimationStart: 0,
      submitting: false,
      error: null,
      success: false,
      email: '',
      feedbackText: '',
      search: null
    }
    this.unsub = null
    this.updateStatus = this.updateStatus.bind(this)
    this.handleFeedbackTextChange = this.handleFeedbackTextChange.bind(this)
    this.handleSubmit = this.handleSubmit.bind(this)
    this.handleEmailChange = this.handleEmailChange.bind(this)
  }
  componentDidMount () {
    this.updateStatus()
    this.unsub = AppState.subscribe(this.updateStatus)
  }
  componentWillUnmount () {
    this.unsub()
    this.unsub = null
  }
  updateStatus () {
    let { feedback } = AppState.getState()
    if (feedback.show !== this.state.show) {
      this.setState({show: feedback.show, topAnimationStart: Date.now() + (feedback.show ? 100 : 0), search: feedback.search})
      this.props.onChangeShow && this.props.onChangeShow(feedback.show)
    }
    this.setState({search: feedback.search, feedbackText: feedback.feedbackText, email: feedback.email})
  }
  render () {
    let topAnimationProgress = 1 - Math.pow(1 - (Math.max(0, Date.now() - this.state.topAnimationStart) / 500), 3)
    let topPs = 0
    let show = this.state.show || topAnimationProgress < 1
    if (topAnimationProgress < 1) {
      if (!this.state.show) {
        topPs = topAnimationProgress
      } else {
        topPs = 1 - topAnimationProgress
      }
      this.nextFrameForceUpdate()
    }
    let content = this.getContent()
    return (
      <div className={'feedback' + (show ? '' : ' hide')} style={Object.assign({}, topPs ? {transform: `translateY(${(Math.round(topPs * 1000) / 10)}%)`, willChange: 'transform'} : {})}>
        <div className='top'>
          <span className='close' onClick={evt => {
            this.setState({success: false, error: null})
            AppState.dispatch({type: 'hideFeedback'})
          }}>Hide</span>
          &nbsp;
          Feedback
        </div>
        <div className='content'>
          <p>
            <b>I'm sorry.</b> I haven't had time to read and respond to all the feedbacks, and will not likely be
            able to in the future. Your feedbacks will likely not be read for a long time, please bear in mind.
            Thanks for your understanding.
          </p>
          {content}
        </div>
      </div>
    )
  }
  getContent () {
    if (this.state.success) {
      return (
        <div className='success'>
          <h2>Thank you!</h2>
          <p>Your feedback had been submitted successfully.</p>
        </div>
      )
    }
    let desc = null
    if (!this.state.search) {
      desc = (
        <div>
          <h2>General feedback</h2>
          <p>If you want to report errors, use feedback button in the search result.</p>
        </div>
      )
    } else {
      desc = (
        <div>
          <h2>Search feedback</h2>
          <p className='searchReport'>Reporting issues with search <code>{this.state.search}</code></p>
        </div>
      )
    }
    return (
      <div className='general'>
        {desc}
        <p>Provide your feedback in <b>either</b> English or Chinese.</p>
        <ul>
          <li>If you are requesting a feture or a change, please give example of how to improve / implementation.</li>
          <li>
            If you are requesting for supporting a new syllabus, please provide link to the cie.org.uk page of that
            syllabus, and if possible, link for finding its past papers
            (especially s/w {(new Date().getFullYear() - 1).toString().substr(-2, 2)}).
          </li>
        </ul>
        <textarea onChange={this.handleFeedbackTextChange} value={this.state.feedbackText}
          placeholder='Your feedback here...' disabled={this.state.submitting} />
        <p>Email address... (Optional)</p>
        <input type='email' placeholder='someone@example.com' className='email' disabled={this.state.submitting}
          onChange={this.handleEmailChange} value={this.state.email} />
        {
          this.state.error
          ? <div className='error'>Can't submit: {this.state.error}</div>
          : null
        }
        {
          this.state.submitting
            ? <div className='submitting'>Submitting</div>
            : <div className='submit' onClick={this.handleSubmit}>Submit</div>
        }
      </div>
    )
  }
  handleFeedbackTextChange (evt) {
    let val = evt.target.value
    AppState.dispatch({type: 'writeFeedbackText', feedbackText: val})
  }
  handleEmailChange (evt) {
    let val = evt.target.value
    AppState.dispatch({type: 'writeEmail', email: val})
  }
  handleSubmit (evt) {
    let val = this.state.feedbackText
    this.setState({submitting: true, error: null})
    let ctHeaders = new Headers()
    ctHeaders.append('Content-Type', 'application/json')
    fetch('/feedback/', {method: 'POST', body: JSON.stringify({
      email: this.state.email,
      text: this.state.feedbackText,
      search: this.state.search
    }), headers: ctHeaders}).then(res => {
      if (!res.ok) {
        res.text().then(errText => {
          this.setState({submitting: false, error: errText})
        }, err => {
          this.setState({submitting: false, error: 'Unknow error.'})
        })
      } else {
        AppState.dispatch({type: 'writeFeedbackText', feedbackText: ''})
        AppState.dispatch({type: 'writeEmail', email: ''})
        this.setState({submitting: false, success: true})
      }
    }, err => {
      this.setState({submitting: false, error: err.message})
    })
  }
}
